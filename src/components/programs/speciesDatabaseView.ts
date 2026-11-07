import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  fromSupabaseResult,
  ok,
  unwrapAppResult,
  type AppResult,
} from "../../lib/appResult.ts";

/** Scope passed to `useAuthenticatedQuery`. The hook adds the verified user id. */
export const SPECIES_DATABASE_QUERY_KEY = ["species-database", "list"] as const;

export const SPECIES_LIST_COLUMNS =
  "id, display_name, general_description, diet_preferences, habitat_preferences, handling_guidance, minimum_handlers, safety_class, updated_at";

/** PostgREST returns at most this many rows unless the caller pages. */
export const SPECIES_LIST_PAGE_SIZE = 1000;

export const SAFETY_CLASSES = ["low", "moderate", "high", "critical"] as const;

export type SafetyClass = (typeof SAFETY_CLASSES)[number];

/** PostgreSQL `smallint` upper bound. The column also requires a value > 0. */
const POSTGRES_SMALLINT_MAX = 32_767;

/**
 * Fields a Senior or Management user may submit for an existing species.
 * Identity and audit columns are not part of this payload.
 */
export type SpeciesEditableFields = {
  display_name: string;
  general_description: string;
  diet_preferences: string;
  habitat_preferences: string;
  handling_guidance: string;
  minimum_handlers: number;
  safety_class: SafetyClass;
};

export type LocalSpecies = SpeciesEditableFields & {
  id: string;
  /** Database-maintained `timestamptz`, kept as the original response string. */
  updated_at: string;
};

/**
 * ISO-8601 timestamp with a `T` separator, optional fractional seconds and a
 * `Z` or `±HH:MM` offset. The matched text is kept verbatim.
 */
const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:Z|([+-]\d{2}):(\d{2}))$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored prose is kept verbatim. A blank or non-string value is invalid. */
function storedText(value: unknown): AppResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err("validation");
  }
  return ok(value);
}

function storedId(value: unknown): AppResult<string> {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return err("validation");
  }
  return ok(value);
}

function storedSafetyClass(value: unknown): AppResult<SafetyClass> {
  if (
    typeof value !== "string" ||
    !(SAFETY_CLASSES as readonly string[]).includes(value)
  ) {
    return err("validation");
  }
  return ok(value as SafetyClass);
}

function storedHandlerCount(value: unknown): AppResult<number> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > POSTGRES_SMALLINT_MAX
  ) {
    return err("validation");
  }
  return ok(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Accepts a database `timestamptz` string and returns that same string.
 * Validity is checked from the text so fractional seconds are not truncated.
 */
function storedTimestamp(value: unknown): AppResult<string> {
  if (typeof value !== "string") return err("validation");
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  if (!match) return err("validation");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? undefined : Number(match[8].slice(1));
  const offsetMinute = match[9] === undefined ? undefined : Number(match[9]);

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return err("validation");
  }
  if (hour > 23 || minute > 59 || second > 59) return err("validation");
  if (
    offsetHour !== undefined &&
    (offsetHour > 23 || offsetMinute === undefined || offsetMinute > 59)
  ) {
    return err("validation");
  }
  return ok(value);
}

function parseEditableFields(
  value: Record<string, unknown>,
): AppResult<SpeciesEditableFields> {
  const displayName = storedText(value.display_name);
  if (!displayName.ok) return displayName;
  const generalDescription = storedText(value.general_description);
  if (!generalDescription.ok) return generalDescription;
  const dietPreferences = storedText(value.diet_preferences);
  if (!dietPreferences.ok) return dietPreferences;
  const habitatPreferences = storedText(value.habitat_preferences);
  if (!habitatPreferences.ok) return habitatPreferences;
  const handlingGuidance = storedText(value.handling_guidance);
  if (!handlingGuidance.ok) return handlingGuidance;
  const minimumHandlers = storedHandlerCount(value.minimum_handlers);
  if (!minimumHandlers.ok) return minimumHandlers;
  const safetyClass = storedSafetyClass(value.safety_class);
  if (!safetyClass.ok) return safetyClass;

  return ok({
    display_name: displayName.data,
    general_description: generalDescription.data,
    diet_preferences: dietPreferences.data,
    habitat_preferences: habitatPreferences.data,
    handling_guidance: handlingGuidance.data,
    minimum_handlers: minimumHandlers.data,
    safety_class: safetyClass.data,
  });
}

/**
 * Validates an edit payload. Missing fields fail; none are filled in here.
 * Accepted text is returned unchanged, including surrounding whitespace.
 */
export function parseSpeciesEditableFields(
  value: unknown,
): AppResult<SpeciesEditableFields> {
  if (!isRecord(value)) return err("validation");
  return parseEditableFields(value);
}

/**
 * Identity and the original concurrency token for an update.
 * `updated_at` is returned unchanged so a later write can match that exact value.
 */
export function parseSpeciesConcurrencyKey(
  value: unknown,
): AppResult<Pick<LocalSpecies, "id" | "updated_at">> {
  if (!isRecord(value)) return err("validation");
  const id = storedId(value.id);
  if (!id.ok) return id;
  const updatedAt = storedTimestamp(value.updated_at);
  if (!updatedAt.ok) return updatedAt;
  return ok({ id: id.data, updated_at: updatedAt.data });
}

function parseSpeciesRow(value: unknown): AppResult<LocalSpecies> {
  if (!isRecord(value)) return err("validation");

  const id = storedId(value.id);
  if (!id.ok) return id;
  const updatedAt = storedTimestamp(value.updated_at);
  if (!updatedAt.ok) return updatedAt;
  const fields = parseEditableFields(value);
  if (!fields.ok) return fields;

  return ok({
    id: id.data,
    ...fields.data,
    updated_at: updatedAt.data,
  });
}

export function compareLocalSpecies(a: LocalSpecies, b: LocalSpecies): number {
  const byName = a.display_name.localeCompare(b.display_name, undefined, {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export function sortLocalSpecies(
  species: readonly LocalSpecies[],
): LocalSpecies[] {
  return species.toSorted(compareLocalSpecies);
}

/**
 * Accepts a successful list payload, including an empty array.
 * A non-array payload or any invalid row fails the whole list.
 * The returned rows are ordered for display.
 */
export function parseSpeciesList(payload: unknown): AppResult<LocalSpecies[]> {
  if (!Array.isArray(payload)) return err("validation");

  const species: LocalSpecies[] = [];
  for (const row of payload) {
    const parsed = parseSpeciesRow(row);
    if (!parsed.ok) return parsed;
    species.push(parsed.data);
  }
  return ok(sortLocalSpecies(species));
}

/** Blank input keeps the full list. Matching uses `display_name` only. */
export function filterSpeciesByName(
  species: readonly LocalSpecies[],
  query: string,
): LocalSpecies[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return species.slice();
  return species.filter((entry) =>
    entry.display_name.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Keeps `selectedId` when that row is still visible.
 * Otherwise selects the first visible row, or nothing when the list is empty.
 */
export function resolveSelectedSpeciesId(
  visible: readonly Pick<LocalSpecies, "id">[],
  selectedId: string | null,
): string | null {
  if (visible.length === 0) return null;
  if (
    selectedId !== null &&
    visible.some((entry) => entry.id === selectedId)
  ) {
    return selectedId;
  }
  return visible[0].id;
}

export async function fetchLocalSpecies(
  supabase: SupabaseClient,
  signal: AbortSignal,
): Promise<LocalSpecies[]> {
  const collected: LocalSpecies[] = [];
  let offset = 0;

  for (;;) {
    const response = await supabase
      .from("species_database")
      .select(SPECIES_LIST_COLUMNS)
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + SPECIES_LIST_PAGE_SIZE - 1)
      .abortSignal(signal);

    const page = unwrapAppResult(
      parseSpeciesList(unwrapAppResult(fromSupabaseResult(response))),
    );
    collected.push(...page);
    if (page.length < SPECIES_LIST_PAGE_SIZE) break;
    offset += page.length;
  }

  return sortLocalSpecies(collected);
}
