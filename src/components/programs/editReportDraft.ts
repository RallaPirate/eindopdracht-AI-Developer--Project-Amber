import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  AuthenticatedMutationCallbackContext,
  AuthenticatedMutationContext,
} from "@/hooks/useAuthenticatedQuery";
import { err, fromSupabaseResult, fromSupabaseSingleResult, unwrapAppResult } from "@/lib/appResult";
import { syncOwnReportDrafts, withReportDraftSession, type NewReportDraft } from "./createReportDraft";
import { DRAFT_COLUMNS, reportDraftSchema } from "./ownReportDrafts";

const DETAIL_COLUMNS = `${DRAFT_COLUMNS}, specimen_id, body, review_status, record_status`;

export const reportDraftDetailSchema = reportDraftSchema.extend({
  specimen_id: z.guid().nullable(),
  body: z.string().nullable(),
  review_status: z.literal("draft"),
  record_status: z.literal("active"),
});

export type ReportDraftDetail = z.infer<typeof reportDraftDetailSchema>;

export function reportDraftDetailQueryKey(reportId: string | null) {
  return ["reports", "draft-detail", reportId] as const;
}

function parseReportDraftDetail(reportId: string, row: unknown): ReportDraftDetail {
  const parsed = reportDraftDetailSchema.safeParse(row);
  if (!parsed.success || parsed.data.id !== reportId) {
    return unwrapAppResult(err("database"));
  }
  return parsed.data;
}

export async function fetchReportDraftDetail(
  supabase: SupabaseClient,
  reportId: string,
  signal: AbortSignal,
): Promise<ReportDraftDetail | null> {
  const response = await supabase
    .from("reports")
    .select(DETAIL_COLUMNS)
    .eq("id", reportId)
    .eq("review_status", "draft")
    .eq("record_status", "active")
    .abortSignal(signal)
    .maybeSingle();
  const row = unwrapAppResult(fromSupabaseResult(response));
  return row === null ? null : parseReportDraftDetail(reportId, row);
}

export async function updateReportDraft(
  supabase: SupabaseClient,
  reportId: string,
  draft: NewReportDraft,
  context: AuthenticatedMutationContext,
): Promise<ReportDraftDetail> {
  const { species_id, specimen_id, report_type, title, body } = draft;
  const response = await withReportDraftSession(supabase, context, (accessToken, signal) => supabase
    .from("reports")
    .update({ species_id, specimen_id, report_type, title, body })
    .eq("id", reportId)
    .eq("review_status", "draft")
    .eq("record_status", "active")
    .select(DETAIL_COLUMNS)
    .abortSignal(signal)
    .maybeSingle()
    .setHeader("Authorization", `Bearer ${accessToken}`));
  const persisted = parseReportDraftDetail(reportId, unwrapAppResult(fromSupabaseSingleResult(response)));
  if (
    persisted.species_id !== species_id || persisted.specimen_id !== specimen_id
    || persisted.report_type !== report_type || persisted.title !== title || persisted.body !== body
  ) {
    return unwrapAppResult(err("database"));
  }
  return persisted;
}

export function syncEditedReportDraft(draft: ReportDraftDetail, context: AuthenticatedMutationCallbackContext) {
  const { id, title, report_type, species_id, updated_at } = draft;
  syncOwnReportDrafts({ id, title, report_type, species_id, updated_at }, context);
  const key = reportDraftDetailQueryKey(id);
  // Seed before invalidating so a pre-save fetch is cancelled and restarted.
  context.cache.setQueryData(key, draft);
  void context.cache.invalidateQueries(key);
}
