import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  AuthenticatedMutationCallbackContext,
  AuthenticatedMutationContext,
} from "@/hooks/useAuthenticatedQuery";
import { err, fromSupabaseSingleResult, unwrapAppResult } from "@/lib/appResult";
import {
  AuthenticatedQueryIdentityError,
  isAuthenticatedAccessCurrent,
} from "@/lib/queryCacheIsolation";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import {
  compareReportDrafts,
  DRAFT_COLUMNS,
  OWN_REPORT_DRAFTS_QUERY_KEY,
  REPORT_TYPES,
  reportDraftSchema,
  type ReportDraft,
} from "./ownReportDrafts";
import { SPECIES_DATABASE_QUERY_KEY, type LocalSpecies } from "./speciesDatabaseView";
import { specimensForSpeciesQueryKey, type SpecimenOption } from "./specimenSelection";

// PostgreSQL's default trim removes U+0020 spaces only.
const optionalText = z.string().transform((value) => /[^ ]/.test(value) ? value : null);

export const newReportDraftSchema = z.object({
  species_id: z.guid(),
  specimen_id: z.guid().nullable(),
  report_type: z.enum(REPORT_TYPES).nullable(),
  title: optionalText,
  body: optionalText,
});

type NewReportDraft = z.output<typeof newReportDraftSchema>;

const persistedDraftSchema = reportDraftSchema.extend({
  created_by: z.guid(),
  specimen_id: z.guid().nullable(),
  review_status: z.literal("draft"),
  record_status: z.literal("active"),
});

export function validateDraftSubject(
  { species_id, specimen_id }: NewReportDraft,
  { cache }: AuthenticatedMutationCallbackContext,
) {
  const species = cache.getQueryData<LocalSpecies[]>(SPECIES_DATABASE_QUERY_KEY);
  if (!species?.some((entry) => entry.id === species_id)) {
    unwrapAppResult(err("validation"));
  }
  if (specimen_id === null) return;

  const specimens = cache.getQueryData<SpecimenOption[]>(specimensForSpeciesQueryKey(species_id));
  if (!specimens?.some((entry) => entry.id === specimen_id && entry.species_id === species_id)) {
    unwrapAppResult(err("validation"));
  }
}

export async function createReportDraft(
  supabase: SupabaseClient,
  draft: NewReportDraft,
  { userId }: AuthenticatedMutationContext,
): Promise<ReportDraft> {
  const epoch = getVerifiedAuthSnapshot().accessEpoch;
  const { data: { session }, error } = await supabase.auth.getSession();
  const current = getVerifiedAuthSnapshot();
  if (
    current.status !== "ready"
    || !isAuthenticatedAccessCurrent(current.userId, current.accessEpoch, { userId, epoch })
  ) {
    throw new AuthenticatedQueryIdentityError();
  }
  if (error || session?.user.id !== userId || !session.access_token) {
    return unwrapAppResult(err("unauthenticated"));
  }

  const response = await supabase
    .from("reports")
    .insert({
      species_id: draft.species_id,
      specimen_id: draft.specimen_id,
      report_type: draft.report_type,
      title: draft.title,
      body: draft.body,
    })
    .select(`${DRAFT_COLUMNS}, specimen_id, created_by, review_status, record_status`)
    .single()
    // Bind this request to its original session even if the shared client
    // resolves a different default token before the POST goes out.
    .setHeader("Authorization", `Bearer ${session.access_token}`);
  const persisted = persistedDraftSchema.safeParse(
    unwrapAppResult(fromSupabaseSingleResult(response)),
  );
  if (
    !persisted.success
    || persisted.data.species_id !== draft.species_id
    || persisted.data.specimen_id !== draft.specimen_id
    || persisted.data.report_type !== draft.report_type
    || persisted.data.title !== draft.title
  ) {
    return unwrapAppResult(err("database"));
  }

  const { id, title, report_type, species_id, updated_at } = persisted.data;
  return { id, title, report_type, species_id, updated_at };
}

export function syncOwnReportDrafts(
  draft: ReportDraft,
  { cache }: AuthenticatedMutationCallbackContext,
) {
  const drafts = cache.getQueryData<ReportDraft[]>(OWN_REPORT_DRAFTS_QUERY_KEY) ?? [];
  const draftsById = new Map(drafts.map((cached) => [cached.id, cached]));
  draftsById.set(draft.id, draft);
  const merged = [...draftsById.values()].sort(compareReportDrafts);
  // With data in the cache, invalidation cancels an in-flight initial read
  // and starts a fresh one instead of reusing the pre-INSERT request.
  cache.setQueryData(OWN_REPORT_DRAFTS_QUERY_KEY, merged);
  void cache.invalidateQueries(OWN_REPORT_DRAFTS_QUERY_KEY);
}
