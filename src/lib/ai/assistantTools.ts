import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";

// Validated against Open-Meteo's sea-cell forecast on 2026-11-08:
// grid centre 9.033392, -85.0173, elevation 0 m, America/Costa_Rica.
// Pacific waters south of the Nicoya peninsula; callers cannot change location.
export const WEATHER_LOCATION = { latitude: 9, longitude: -85, timezone: "America/Costa_Rica" } as const;
export const SPECIES_COLUMNS = "id, display_name, general_description, diet_preferences, habitat_preferences, handling_guidance, minimum_handlers, safety_class, updated_at";
export const TOOL_LIMITS = { executions: 4, timeoutMs: 8_000, weatherBytes: 32_768, resultBytes: 32_768 } as const;

const prose = z.string().trim().min(1).max(4_000);
const speciesSchema = z.object({
  id: z.uuid(), display_name: z.string().min(1).max(200),
  general_description: prose, diet_preferences: prose, habitat_preferences: prose,
  handling_guidance: prose, minimum_handlers: z.number().int().min(1).max(32_767),
  safety_class: z.enum(["low", "moderate", "high", "critical"]),
  updated_at: z.iso.datetime({ offset: true }),
});

export const searchSpeciesSchema = z.strictObject({ query: z.string().trim().min(1).max(80) });
export const weatherInputSchema = z.strictObject({ date: z.iso.date() });

function failure(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

export function costaRicaDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: WEATHER_LOCATION.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type AssistantToolDependencies = {
  supabase: SupabaseClient;
  signal: AbortSignal;
  fetchWeather?: typeof fetch;
  now?: () => Date;
};

/** All mutable budget state belongs to this request, never to a shared Agent. */
export function createAssistantTools({ supabase, signal, fetchWeather = fetch, now = () => new Date() }: AssistantToolDependencies) {
  let executions = 0;
  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>) => {
    if (signal.aborted) return failure("timeout", "The Assistant request was stopped or timed out.");
    if (executions >= TOOL_LIMITS.executions) return failure("limit", "The tool execution limit was reached.");
    executions += 1;
    const toolSignal = AbortSignal.any([signal, AbortSignal.timeout(TOOL_LIMITS.timeoutMs)]);
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        operation(toolSignal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("aborted"));
          toolSignal.addEventListener("abort", onAbort, { once: true });
          if (toolSignal.aborted) onAbort();
        }),
      ]);
    } catch {
      return toolSignal.aborted
        ? failure("timeout", "The retrieval was stopped or timed out.")
        : failure("unavailable", "The requested data is unavailable.");
    } finally {
      toolSignal.removeEventListener("abort", onAbort);
    }
  };

  return {
    searchSpecies: tool({
      description: "Search up to five local species by display name. Local species guidance is not reviewed knowledge-index evidence. Refine ambiguous names with another search.",
      inputSchema: searchSpeciesSchema,
      execute: async (input) => run(async (toolSignal) => {
        const { query } = searchSpeciesSchema.parse(input);
        if (query.includes("*")) return failure("validation", "Species search queries must not contain '*'.");
        const literal = query.replace(/[\\%_]/g, "\\$&");
        const { data, error } = await supabase.from("species_database")
          .select(SPECIES_COLUMNS).ilike("display_name", `%${literal}%`)
          .order("display_name").order("id").limit(5).abortSignal(toolSignal);
        if (error) return failure("unavailable", "Local species retrieval is unavailable.");
        const parsed = z.array(speciesSchema).max(5).safeParse(data);
        if (!parsed.success || new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > TOOL_LIMITS.resultBytes) {
          return failure("invalid_data", "Local species data is invalid or too large. Refine the search.");
        }
        if (parsed.data.length === 0) return failure("missing_data", "No matching local species were found.");
        return { ok: true as const, source: "species_database", authority: "local_species_guidance_not_knowledge_index", untrustedData: true,
          retrievedAt: now().toISOString(), limitedTo: 5, records: parsed.data };
      }),
    }),
    getWeather: tool({
      description: "Daily weather forecast at the fixed offshore Costa Rica location. Date must be today through six days ahead in America/Costa_Rica. No other location is available.",
      inputSchema: weatherInputSchema,
      execute: async (input) => run(async (toolSignal) => {
        const { date } = weatherInputSchema.parse(input);
        const today = costaRicaDate(now());
        const end = new Date(`${today}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 6);
        if (date < today || date > end.toISOString().slice(0, 10)) return failure("unsupported_date", "Weather is available only for today through six days ahead in Costa Rica.");
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        for (const [key, value] of Object.entries({ ...WEATHER_LOCATION, cell_selection: "sea", daily: "temperature_2m_max,precipitation_probability_max,wind_speed_10m_max", start_date: date, end_date: date })) url.searchParams.set(key, String(value));
        const response = await fetchWeather(url, { signal: toolSignal, cache: "no-store", redirect: "error" });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return failure("unavailable", "Open-Meteo weather is unavailable.");
        }
        const reader = response.body.getReader();
        const abort = () => { void reader.cancel().catch(() => {}); };
        toolSignal.addEventListener("abort", abort, { once: true });
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > TOOL_LIMITS.weatherBytes) {
              await reader.cancel();
              return failure("invalid_data", "Open-Meteo returned invalid weather data.");
            }
            chunks.push(value);
          }
        } finally { toolSignal.removeEventListener("abort", abort); }
        toolSignal.throwIfAborted();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        let body: unknown;
        try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch { return failure("invalid_data", "Open-Meteo returned invalid weather data."); }
        const one = (schema: z.ZodNumber) => z.array(schema).length(1);
        const parsed = z.object({
          latitude: z.number().min(8.5).max(9.5), longitude: z.number().min(-85.5).max(-84.5),
          timezone: z.literal(WEATHER_LOCATION.timezone),
          daily_units: z.object({ time: z.literal("iso8601"), temperature_2m_max: z.literal("°C"), precipitation_probability_max: z.literal("%"), wind_speed_10m_max: z.literal("km/h") }),
          daily: z.object({ time: z.array(z.literal(date)).length(1), temperature_2m_max: one(z.number().min(-80).max(65)), precipitation_probability_max: one(z.number().min(0).max(100)), wind_speed_10m_max: one(z.number().min(0).max(500)) }),
        }).safeParse(body);
        if (!parsed.success) return failure("invalid_data", "Open-Meteo returned invalid or missing weather data.");
        return { ok: true as const, source: "Open-Meteo", location: WEATHER_LOCATION, grid: { latitude: parsed.data.latitude, longitude: parsed.data.longitude }, date, retrievedAt: now().toISOString(),
          temperatureMaxC: parsed.data.daily.temperature_2m_max[0], rainChancePercent: parsed.data.daily.precipitation_probability_max[0], windMaxKmh: parsed.data.daily.wind_speed_10m_max[0] };
      }),
    }),
  };
}
