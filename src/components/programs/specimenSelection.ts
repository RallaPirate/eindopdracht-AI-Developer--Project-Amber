import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AppFailure,
  err,
  fromSupabaseResult,
  ok,
  SAFE_ERROR_MESSAGES,
  unwrapAppResult,
  type AppResult,
} from "../../lib/appResult.ts";

/**
 * Scope passed to `useAuthenticatedQuery`. The hook adds the verified user id.
 * `speciesId` keeps each species list in its own cache entry.
 */
export function specimensForSpeciesQueryKey(speciesId: string) {
  return ["specimens", "by-species", speciesId] as const;
}

/** Observed only while no species is selected, and never fetched. */
export const SPECIMENS_IDLE_QUERY_KEY = ["specimens", "idle"] as const;

export const SPECIMEN_LIST_COLUMNS =
  "id, species_id, asset_code, nickname, status";

/** PostgREST returns at most this many rows unless the caller pages. */
export const SPECIMEN_LIST_PAGE_SIZE = 1000;

export const SPECIMEN_STATUSES = [
  "active",
  "quarantine",
  "under_treatment",
  "transferred",
  "deceased",
  "missing",
] as const;

export type SpecimenStatus = (typeof SPECIMEN_STATUSES)[number];

/** Fields the report selector needs. Measurements and audit columns stay on the server. */
export type SpecimenOption = {
  id: string;
  species_id: string;
  asset_code: string;
  nickname: string | null;
  status: SpecimenStatus;
};

/** Species is required for a report. Specimen is optional. */
export type SubjectSelection = {
  speciesId: string | null;
  specimenId: string | null;
};

export const EMPTY_SUBJECT_SELECTION: SubjectSelection = {
  speciesId: null,
  specimenId: null,
};

/** One specimen query result. `null` means the list has not arrived. */
export type SpecimenListResponse = {
  speciesId: string;
  specimens: readonly SpecimenOption[];
} | null;

export type SubjectEvent =
  | { type: "species"; speciesId: string | null }
  | {
      type: "specimen";
      specimenId: string | null;
      specimens: readonly SpecimenOption[];
    }
  | {
      type: "records";
      species: readonly { id: string }[] | undefined;
      /**
       * Payload for one requested species. A payload for another species is
       * stale and must not change the selection.
       */
      response: SpecimenListResponse;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedId(value: unknown): AppResult<string> {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return err("validation");
  }
  return ok(value);
}

/**
 * PostgreSQL `trim(text)` removes only U+0020 spaces. JavaScript `trim()`
 * also removes tabs, newlines and other Unicode whitespace, so a stored
 * asset code can be valid in the database and empty only to JavaScript.
 * The original text is kept either way.
 */
function withoutSurroundingSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 32) end -= 1;
  return value.slice(start, end);
}

function storedAssetCode(value: unknown): AppResult<string> {
  if (typeof value !== "string" || withoutSurroundingSpaces(value).length === 0) {
    return err("validation");
  }
  return ok(value);
}

function storedNickname(value: unknown): AppResult<string | null> {
  if (value === null) return ok(null);
  if (typeof value !== "string") return err("validation");
  return ok(value);
}

function storedStatus(value: unknown): AppResult<SpecimenStatus> {
  if (
    typeof value !== "string" ||
    !(SPECIMEN_STATUSES as readonly string[]).includes(value)
  ) {
    return err("validation");
  }
  return ok(value as SpecimenStatus);
}

function parseSpecimenRow(value: unknown): AppResult<SpecimenOption> {
  if (!isRecord(value)) return err("validation");
  const id = storedId(value.id);
  if (!id.ok) return id;
  const speciesId = storedId(value.species_id);
  if (!speciesId.ok) return speciesId;
  const assetCode = storedAssetCode(value.asset_code);
  if (!assetCode.ok) return assetCode;
  const nickname = storedNickname(value.nickname);
  if (!nickname.ok) return nickname;
  const status = storedStatus(value.status);
  if (!status.ok) return status;
  return ok({
    id: id.data,
    species_id: speciesId.data,
    asset_code: assetCode.data,
    nickname: nickname.data,
    status: status.data,
  });
}

function compareSpecimenOptions(a: SpecimenOption, b: SpecimenOption): number {
  const byCode = a.asset_code.localeCompare(b.asset_code, undefined, {
    sensitivity: "base",
  });
  if (byCode !== 0) return byCode;
  return a.id.localeCompare(b.id);
}

function sortSpecimenOptions(
  specimens: readonly SpecimenOption[],
): SpecimenOption[] {
  return specimens.toSorted(compareSpecimenOptions);
}

/**
 * Accepts a successful list payload, including an empty array.
 * A non-array payload or any invalid row fails the whole list.
 */
export function parseSpecimenList(payload: unknown): AppResult<SpecimenOption[]> {
  if (!Array.isArray(payload)) return err("validation");
  const specimens: SpecimenOption[] = [];
  for (const row of payload) {
    const parsed = parseSpecimenRow(row);
    if (!parsed.ok) return parsed;
    specimens.push(parsed.data);
  }
  return ok(sortSpecimenOptions(specimens));
}

/** Keeps specimens whose `species_id` is `speciesId`, in their existing order. */
export function filterSpecimensBySpecies(
  specimens: readonly SpecimenOption[],
  speciesId: string,
): SpecimenOption[] {
  return specimens.filter((specimen) => specimen.species_id === speciesId);
}

export function specimenOptionLabel(specimen: SpecimenOption): string {
  const nickname = specimen.nickname?.trim() ?? "";
  const identity = nickname.length > 0
    ? `${specimen.asset_code} — ${nickname}`
    : specimen.asset_code;
  return `${identity} (${specimen.status})`;
}

function chooseSpecies(
  selection: SubjectSelection,
  speciesId: string,
): SubjectSelection {
  if (selection.speciesId === speciesId) return selection;
  return { speciesId, specimenId: null };
}

function chooseSpecimen(
  selection: SubjectSelection,
  specimenId: string | null,
  specimens: readonly SpecimenOption[],
): SubjectSelection {
  if (selection.speciesId === null) {
    return selection.specimenId === null ? selection : EMPTY_SUBJECT_SELECTION;
  }
  if (specimenId === null) {
    return selection.specimenId === null
      ? selection
      : { speciesId: selection.speciesId, specimenId: null };
  }
  const matches = specimens.some(
    (specimen) =>
      specimen.id === specimenId && specimen.species_id === selection.speciesId,
  );
  if (!matches) {
    return selection.specimenId === null
      ? selection
      : { speciesId: selection.speciesId, specimenId: null };
  }
  if (selection.specimenId === specimenId) return selection;
  return { speciesId: selection.speciesId, specimenId };
}

/**
 * Applies one specimen response.
 * A response for a different species, or a mixed payload, is ignored so a
 * late result cannot clear the current species or restore a specimen the
 * user has already left. An empty list for the current species clears only
 * the specimen.
 */
export function applySpecimenList(
  selection: SubjectSelection,
  responseSpeciesId: string,
  specimens: readonly SpecimenOption[],
): SubjectSelection {
  if (selection.speciesId !== responseSpeciesId) return selection;
  for (const specimen of specimens) {
    if (specimen.species_id !== responseSpeciesId) return selection;
  }
  if (selection.specimenId === null) return selection;
  const stillThere = specimens.some((specimen) => specimen.id === selection.specimenId);
  if (stillThere) return selection;
  return { speciesId: selection.speciesId, specimenId: null };
}

function reconcileSubjectSelection(
  selection: SubjectSelection,
  species: readonly { id: string }[] | undefined,
  response: SpecimenListResponse,
): SubjectSelection {
  if (species === undefined) return selection;
  if (selection.speciesId === null) {
    return selection.specimenId === null ? selection : EMPTY_SUBJECT_SELECTION;
  }
  if (!species.some((entry) => entry.id === selection.speciesId)) {
    return EMPTY_SUBJECT_SELECTION;
  }
  if (response === null) return selection;
  return applySpecimenList(selection, response.speciesId, response.specimens);
}

/**
 * Species changes drop the specimen immediately.
 * Specimen responses never choose a specimen; they only keep or clear one.
 */
export function reduceReportSubject(
  selection: SubjectSelection,
  event: SubjectEvent,
): SubjectSelection {
  switch (event.type) {
    case "species":
      if (event.speciesId === null) {
        return selection.speciesId === null && selection.specimenId === null
          ? selection
          : EMPTY_SUBJECT_SELECTION;
      }
      return chooseSpecies(selection, event.speciesId);
    case "specimen":
      return chooseSpecimen(selection, event.specimenId, event.specimens);
    case "records":
      return reconcileSubjectSelection(selection, event.species, event.response);
  }
}

function pageForSpecies(payload: unknown, speciesId: string): SpecimenOption[] {
  const parsed = unwrapAppResult(parseSpecimenList(payload));
  if (parsed.some((specimen) => specimen.species_id !== speciesId)) {
    throw new AppFailure({
      code: "validation",
      message: SAFE_ERROR_MESSAGES.validation,
    });
  }
  return parsed;
}

export async function fetchSpecimensForSpecies(
  supabase: SupabaseClient,
  speciesId: string,
  signal: AbortSignal,
): Promise<SpecimenOption[]> {
  const species = storedId(speciesId);
  if (!species.ok) throw new AppFailure(species.error);

  const collected: SpecimenOption[] = [];
  let offset = 0;

  for (;;) {
    const response = await supabase
      .from("specimens")
      .select(SPECIMEN_LIST_COLUMNS)
      .eq("species_id", species.data)
      .order("asset_code", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + SPECIMEN_LIST_PAGE_SIZE - 1)
      .abortSignal(signal);

    const page = pageForSpecies(
      unwrapAppResult(fromSupabaseResult(response)),
      species.data,
    );
    collected.push(...page);
    if (page.length < SPECIMEN_LIST_PAGE_SIZE) break;
    offset += page.length;
  }

  return sortSpecimenOptions(collected);
}
