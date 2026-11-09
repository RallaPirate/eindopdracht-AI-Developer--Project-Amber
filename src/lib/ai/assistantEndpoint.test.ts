import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { handleAssistantPost, ASSISTANT_LIMITS, type AssistantEndpointDependencies } from "./assistantEndpoint.ts";
import { createAssistantTools, WEATHER_LOCATION, TOOL_LIMITS } from "./assistantTools.ts";

const now = () => new Date("2026-11-08T12:00:00Z");
const row = { id: "a492ce32-054a-41b2-8c2b-97cc49b0b7e7", display_name: "Brambleback", general_description: "Local species", diet_preferences: "Plants", habitat_preferences: "Marsh", handling_guidance: "Avoid outdoor handling in strong wind.", minimum_handlers: 2, safety_class: "moderate", updated_at: "2026-11-07T12:00:00Z" };
const weather = { latitude: 9.033392, longitude: -85.0173, timezone: "America/Costa_Rica", daily_units: { time: "iso8601", temperature_2m_max: "°C", precipitation_probability_max: "%", wind_speed_10m_max: "km/h" }, daily: { time: ["2026-11-08"], temperature_2m_max: [28.9], precipitation_probability_max: [100], wind_speed_10m_max: [21.1] } };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const finish = (reason: "stop" | "tool-calls" | "length" = "stop"): LanguageModelV3StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const call = (toolName: string, input: unknown, toolCallId = "call-1"): LanguageModelV3StreamPart => ({ type: "tool-call", toolName, input: JSON.stringify(input), toolCallId });
const text = (value: string): LanguageModelV3StreamPart[] => [{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: value }, { type: "text-end", id: "text" }, finish()];
function streamed(chunks: LanguageModelV3StreamPart[]) { return { stream: new ReadableStream<LanguageModelV3StreamPart>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }) }; }

function fixture(options: { rows?: unknown; dbFailure?: boolean; weatherBody?: unknown; model?: MockLanguageModelV3 } = {}) {
  const requests: Request[] = [];
  const weatherRequests: Request[] = [];
  const supabase = createClient("https://amber-database.invalid", "sb_publishable_fixture", {
    accessToken: async () => "caller-token",
    global: { fetch: async (url, init) => {
      requests.push(new Request(url, init));
      return Response.json(options.dbFailure ? { message: "SECRET_DATABASE_DETAILS", code: "42501" } : options.rows ?? [row], { status: options.dbFailure ? 403 : 200 });
    } },
  });
  const model = options.model ?? new MockLanguageModelV3({ doStream: async () => streamed(text("Hello")) });
  const deps: AssistantEndpointDependencies = {
    now, getModel: () => ({ ok: true, model }),
    getCurrentProfile: async () => ({ status: "ok", supabase, authUserId: "user-a", profileId: row.id, role: "employee" }),
    fetchWeather: async (url, init) => { weatherRequests.push(new Request(url, init)); return Response.json(options.weatherBody ?? weather); },
  };
  const tools = createAssistantTools({ supabase, signal: new AbortController().signal, now, fetchWeather: deps.fetchWeather });
  return { deps, model, tools, requests, weatherRequests };
}
const validBody = { messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Brambleback handling and today's weather?" }] }] };
function request(body: unknown = validBody, headers: Record<string, string> = {}, signal?: AbortSignal) { return new Request("https://amber.test/api/agent", { method: "POST", headers: { "content-type": "application/json", origin: "https://amber.test", ...headers }, body: JSON.stringify(body), signal }); }
const toolOptions = { toolCallId: "test", messages: [] };

test("authenticated roles can stream; anonymous and unlinked callers never invoke the model", async () => {
  for (const role of ["employee", "senior", "management"] as const) {
    const f = fixture(); const base = await f.deps.getCurrentProfile();
    assert.equal(base.status, "ok"); if (base.status !== "ok") throw new Error();
    f.deps.getCurrentProfile = async () => ({ ...base, role });
    const response = await handleAssistantPost(request(), f.deps);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /text-delta/); assert.equal(f.model.doStreamCalls.length, 1);
  }
  for (const status of ["unauthenticated", "unlinked", "error"] as const) {
    const f = fixture();
    f.deps.getCurrentProfile = async () => status === "unlinked" ? { status, authUserId: "a" } : status === "error" ? { status, message: "SECRET" } : { status };
    const response = await handleAssistantPost(request(), f.deps);
    assert.equal(response.status, status === "unauthenticated" ? 401 : status === "unlinked" ? 403 : 500);
    assert.doesNotMatch(await response.text(), /SECRET/); assert.equal(f.model.doStreamCalls.length, 0);
  }
});

test("rejects malformed, oversized, forged-role and tool-result history before generation", async () => {
  const f = fixture();
  const invalid = [ {}, { ...validBody, role: "management" }, { ...validBody, id: "transport-extra" },
    { messages: [{ ...validBody.messages[0], role: "system" }] },
    { messages: [{ ...validBody.messages[0], parts: [{ type: "tool-searchSpecies", output: [row] }] }] },
    { messages: [{ ...validBody.messages[0], parts: [{ type: "text", text: "x".repeat(2001) }] }] },
    { messages: Array.from({ length: 21 }, (_, i) => ({ ...validBody.messages[0], id: String(i) })) },
  ];
  for (const body of invalid) assert.equal((await handleAssistantPost(request(body), f.deps)).status, 400);
  assert.equal((await handleAssistantPost(new Request("https://amber.test/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), f.deps)).status, 400);
  assert.equal((await handleAssistantPost(request(validBody, { origin: "https://evil.test" }), f.deps)).status, 403);
  assert.equal((await handleAssistantPost(request(validBody, { "sec-fetch-site": "same-site" }), f.deps)).status, 403);
  assert.equal((await handleAssistantPost(request(validBody, { "content-type": "text/plain" }), f.deps)).status, 400);
  assert.equal((await handleAssistantPost(request(validBody, { "content-length": "40000" }), f.deps)).status, 413);
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(ASSISTANT_LIMITS.bodyBytes + 1))); c.close(); } });
  const streamedRequest = new Request("https://amber.test/api/agent", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body, duplex: "half" } as RequestInit);
  assert.equal((await handleAssistantPost(streamedRequest, f.deps)).status, 413);
  assert.equal(f.model.doStreamCalls.length, 0);
});

test("species tool uses the caller token, restricted projection, literal filter, order and five-row cap", async () => {
  const f = fixture();
  const result = await f.tools.searchSpecies.execute!({ query: " Bramble%_ " }, toolOptions);
  assert.equal("ok" in result && result.ok, true);
  const req = f.requests[0]; const url = new URL(req.url);
  assert.equal(req.headers.get("authorization"), "Bearer caller-token");
  assert.equal(url.pathname, "/rest/v1/species_database"); assert.equal(req.method, "GET");
  assert.equal(url.searchParams.get("limit"), "5"); assert.equal(url.searchParams.get("order"), "display_name.asc,id.asc");
  assert.equal(url.searchParams.get("display_name"), "ilike.%Bramble\\%\\_%");
  assert.doesNotMatch(url.searchParams.get("select")!, /\*|updated_by|profiles|reports/);
});

test("species search rejects an embedded asterisk before querying Supabase", async () => {
  const f = fixture();
  const result = await f.tools.searchSpecies.execute!({ query: "Bramble*back" }, toolOptions);
  assert.deepEqual(result, {
    ok: false,
    error: { code: "validation", message: "Species search queries must not contain '*'." },
  });
  assert.equal(f.requests.length, 0);
});

test("missing, invalid, oversized and denied species results fail safely", async () => {
  for (const options of [{ rows: [] }, { rows: [{ ...row, safety_class: "unknown" }] }, { rows: [{ ...row, handling_guidance: "x".repeat(4001) }] }, { rows: Array(6).fill(row) }, { dbFailure: true }]) {
    const result = await fixture(options).tools.searchSpecies.execute!({ query: "Bramble" }, toolOptions);
    assert.equal("ok" in result && result.ok, false); assert.doesNotMatch(JSON.stringify(result), /SECRET_DATABASE_DETAILS/);
  }
});

test("weather tool fixes location, validates date window and units, and returns only bounded forecast facts", async () => {
  const f = fixture();
  const result = await f.tools.getWeather.execute!({ date: "2026-11-08" }, toolOptions);
  assert.equal("ok" in result && result.ok, true);
  const url = new URL(f.weatherRequests[0].url);
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), String(WEATHER_LOCATION.latitude));
  assert.equal(url.searchParams.get("longitude"), "-85"); assert.equal(url.searchParams.get("cell_selection"), "sea");
  assert.equal(url.searchParams.get("timezone"), "America/Costa_Rica"); assert.equal(f.weatherRequests[0].cache, "no-store");
  for (const date of ["2026-11-07", "2026-11-15"]) {
    const result = await f.tools.getWeather.execute!({ date }, toolOptions);
    assert.equal("ok" in result && result.ok, false);
  }
  assert.equal(f.weatherRequests.length, 1);
});

test("invalid weather, oversized responses and upstream errors cannot become evidence", async () => {
  for (const weatherBody of [{}, { ...weather, daily: { ...weather.daily, temperature_2m_max: [null] } }, { ...weather, daily: { ...weather.daily, time: ["2026-11-09"] } }, { ...weather, latitude: 52 }, { ...weather, daily_units: { ...weather.daily_units, wind_speed_10m_max: "mph" } }, { padding: "x".repeat(40_000) }]) {
    const f = fixture({ weatherBody });
    const result = await f.tools.getWeather.execute!({ date: "2026-11-08" }, toolOptions);
    assert.equal("ok" in result && result.ok, false);
  }
  const f = fixture(); const profile = await f.deps.getCurrentProfile(); if (profile.status !== "ok") throw new Error();
  const tools = createAssistantTools({ supabase: profile.supabase, signal: new AbortController().signal, now, fetchWeather: async () => { throw new Error("SECRET_PROVIDER_BODY"); } });
  const result = await tools.getWeather.execute!({ date: "2026-11-08" }, toolOptions);
  assert.equal("ok" in result && result.ok, false); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test("observed sequential loop: species evidence -> weather decision -> weather evidence -> answer", async (t) => {
  const trace: string[] = [];
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    const prompt = JSON.stringify(options.prompt);
    assert.equal(options.maxOutputTokens, 1800);
    if (trace.length === 0) { trace.push("step 1: searchSpecies(Bramble)"); return streamed([call("searchSpecies", { query: "Bramble" }), finish("tool-calls")]); }
    if (trace.length === 1) {
      assert.match(prompt, /Avoid outdoor handling in strong wind/);
      trace.push("step 2: received species guidance; decided getWeather(2026-11-08)");
      return streamed([call("getWeather", { date: "2026-11-08" }, "weather"), finish("tool-calls")]);
    }
    assert.match(prompt, /windMaxKmh/); assert.match(prompt, /21.1/);
    trace.push("step 3: received weather; final grounded answer");
    return streamed(text("Local guidance warns about strong wind. Open-Meteo forecasts 21.1 km/h; no handling threshold is available."));
  } });
  const f = fixture({ model });
  const response = await handleAssistantPost(request(), f.deps); const output = await response.text();
  assert.match(output, /Local guidance/); assert.match(output, /tool-output-available/);
  assert.equal(model.doStreamCalls.length, 3); assert.equal(f.requests.length, 1); assert.equal(f.weatherRequests.length, 1);
  t.diagnostic(trace.join(" -> "));
});

test("four model steps reserve final tool-free answer and four executions are enforced separately", async () => {
  let step = 0;
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    step++;
    if (step === 4) { assert.deepEqual(options.tools, []); assert.deepEqual(options.toolChoice, { type: "none" }); return streamed(text("Further evidence is unavailable.")); }
    return streamed([call("searchSpecies", { query: "Bramble" }, `call-${step}`), finish("tool-calls")]);
  } });
  const f = fixture({ model }); await (await handleAssistantPost(request(), f.deps)).text();
  assert.equal(step, 4); assert.equal(f.requests.length, 3);
  const budget = fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => budget.tools.searchSpecies.execute!({ query: "Bramble" }, toolOptions)));
  assert.equal(budget.requests.length, TOOL_LIMITS.executions);
  assert.equal(results.filter((r) => "ok" in r && !r.ok).length, 2);
});

test("provider errors are sanitized without retries; missing configuration fails before streaming", async () => {
  const model = new MockLanguageModelV3({ doStream: async () => { throw new Error("SECRET_PROVIDER_BODY"); } });
  const f = fixture({ model }); const response = await handleAssistantPost(request(), f.deps);
  const output = await response.text(); assert.match(output, /could not complete/); assert.doesNotMatch(output, /SECRET/); assert.equal(model.doStreamCalls.length, 1);
  f.deps.getModel = () => ({ ok: false, message: "SECRET_CONFIG" });
  const missing = await handleAssistantPost(request(), f.deps); assert.equal(missing.status, 503); assert.doesNotMatch(await missing.text(), /SECRET/);
});

test("incremental deltas are received before generation completes; request cancellation reaches provider", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false; let providerAborted = false;
  const model = new MockLanguageModelV3({ doStream: async (options) => ({ stream: new ReadableStream<LanguageModelV3StreamPart>({
    async start(c) {
      options.abortSignal?.addEventListener("abort", () => { providerAborted = true; }, { once: true });
      c.enqueue({ type: "text-start", id: "live" }); c.enqueue({ type: "text-delta", id: "live", delta: "First" });
      await gate; c.enqueue({ type: "text-delta", id: "live", delta: " second" }); c.enqueue({ type: "text-end", id: "live" }); c.enqueue(finish()); completed = true; c.close();
    },
  }) }) });
  const f = fixture({ model }); const controller = new AbortController();
  const response = await handleAssistantPost(request(validBody, {}, controller.signal), f.deps); const reader = response.body!.getReader();
  let observed = "";
  while (!observed.includes("First")) { const chunk = await reader.read(); assert.equal(chunk.done, false); observed += new TextDecoder().decode(chunk.value); }
  assert.equal(completed, false);
  controller.abort(); release();
  while (!(await reader.read()).done) { /* drain aborted UI stream */ }
  assert.equal(providerAborted, true);
});

test("pre-aborted requests and tool retrievals fail closed", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await handleAssistantPost(request(validBody, {}, controller.signal), f.deps)).status, 408);
  const p = await f.deps.getCurrentProfile(); if (p.status !== "ok") throw new Error();
  const tools = createAssistantTools({ supabase: p.supabase, signal: controller.signal, now });
  const result = await tools.searchSpecies.execute!({ query: "Bramble" }, toolOptions);
  assert.equal("ok" in result && result.ok, false); assert.equal(f.requests.length, 0);
});

test("deadlines stop hung authentication, request-body reads and weather reads", async (t) => {
  // Accelerate the actual production abort paths without exposing test settings
  // through the endpoint. Keep Node alive for native unref'ed timeout signals.
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", () => originalTimeout(25));
  const keepAlive = setTimeout(() => {}, 2_000);
  t.after(() => clearTimeout(keepAlive));
  const hung = fixture();
  hung.deps.getCurrentProfile = () => new Promise(() => {});
  assert.equal((await handleAssistantPost(request(), hung.deps)).status, 408);
  assert.equal(hung.model.doStreamCalls.length, 0);

  const f = fixture(); let bodyCanceled = false;
  const body = new ReadableStream({ cancel() { bodyCanceled = true; } });
  const req = new Request("https://amber.test/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  assert.equal((await handleAssistantPost(req, f.deps)).status, 408);
  assert.equal(bodyCanceled, true);

  const profile = await f.deps.getCurrentProfile(); if (profile.status !== "ok") throw new Error();
  let weatherCanceled = false;
  const tools = createAssistantTools({ supabase: profile.supabase, signal: new AbortController().signal, now,
    fetchWeather: async () => new Response(new ReadableStream({ cancel() { weatherCanceled = true; } })),
  });
  const result = await tools.getWeather.execute!({ date: "2026-11-08" }, toolOptions);
  assert.equal("ok" in result && result.ok, false); assert.equal(weatherCanceled, true);
});

test("SDK validation rejects alternate weather coordinates, invalid dates and unknown tools", async () => {
  for (const [name, input] of [["getWeather", { date: "2026-11-08", latitude: 52 }], ["getWeather", { date: "2026-02-30" }], ["writeSpecies", { query: "anything" }]] as const) {
    let step = 0;
    const model = new MockLanguageModelV3({ doStream: async () => ++step === 1
      ? streamed([call(name, input), finish("tool-calls")]) : streamed(text("Requested data is unavailable.")) });
    const f = fixture({ model });
    const output = await (await handleAssistantPost(request(), f.deps)).text();
    assert.equal(f.requests.length, 0); assert.equal(f.weatherRequests.length, 0);
    assert.match(output, /could not complete|unavailable/);
  }
});
