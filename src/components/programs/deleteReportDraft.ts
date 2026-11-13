import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthenticatedMutationCallbackContext,
  AuthenticatedMutationContext,
} from "@/hooks/useAuthenticatedQuery";
import { err, fromSupabaseResult, unwrapAppResult } from "@/lib/appResult";
import { withReportDraftSession } from "./createReportDraft";
import { reportDraftDetailQueryKey } from "./editReportDraft";
import { OWN_REPORT_DRAFTS_QUERY_KEY, type ReportDraft } from "./ownReportDrafts";

export async function deleteReportDraft(
  supabase: SupabaseClient,
  reportId: string,
  context: AuthenticatedMutationContext,
): Promise<string> {
  const response = await withReportDraftSession(supabase, context, (accessToken, signal) => supabase
    .from("reports")
    .delete()
    .eq("id", reportId)
    .eq("review_status", "draft")
    .eq("record_status", "active")
    .select("id")
    .abortSignal(signal)
    .setHeader("Authorization", `Bearer ${accessToken}`));
  const rows = unwrapAppResult(fromSupabaseResult(response));
  if (Array.isArray(rows) && rows.length === 0) return unwrapAppResult(err("not_found"));
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== reportId) {
    return unwrapAppResult(err("database"));
  }
  return reportId;
}

export function syncRemovedOwnReportDraft(reportId: string, { cache }: AuthenticatedMutationCallbackContext) {
  const drafts = cache.getQueryData<ReportDraft[]>(OWN_REPORT_DRAFTS_QUERY_KEY);
  if (drafts) {
    cache.setQueryData(OWN_REPORT_DRAFTS_QUERY_KEY, drafts.filter(({ id }) => id !== reportId));
  }
  const detailKey = reportDraftDetailQueryKey(reportId);
  cache.setQueryData(detailKey, null);
  // Seeding data before invalidation replaces in-flight reads with fresh ones.
  void cache.invalidateQueries(OWN_REPORT_DRAFTS_QUERY_KEY);
  void cache.invalidateQueries(detailKey);
}
