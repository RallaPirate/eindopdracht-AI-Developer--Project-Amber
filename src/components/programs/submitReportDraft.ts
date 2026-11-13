import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuthenticatedMutationContext } from "@/hooks/useAuthenticatedQuery";
import { err, fromSupabaseResult, unwrapAppResult } from "@/lib/appResult";
import { withReportDraftSession } from "./createReportDraft";
import { reportDraftDetailSchema, type ReportDraftDetail } from "./editReportDraft";
import { REPORT_TYPES } from "./ownReportDrafts";

const submittableDraftSchema = reportDraftDetailSchema.extend({
  report_type: z.enum(REPORT_TYPES),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const submittedReportSchema = z.object({
  id: z.guid(),
  review_status: z.literal("submitted"),
  record_status: z.literal("active"),
  submitted_at: z.iso.datetime({ offset: true }),
});

export async function submitReportDraft(
  supabase: SupabaseClient,
  draft: ReportDraftDetail,
  context: AuthenticatedMutationContext,
): Promise<string> {
  const parsed = submittableDraftSchema.safeParse(draft);
  if (!parsed.success) return unwrapAppResult(err("validation"));
  const { id, updated_at } = parsed.data;
  const response = await withReportDraftSession(supabase, context, (accessToken, signal) => supabase
    .from("reports")
    .update({ review_status: "submitted" })
    .eq("id", id)
    .eq("review_status", "draft")
    .eq("record_status", "active")
    .eq("updated_at", updated_at)
    .select("id, review_status, record_status, submitted_at")
    .abortSignal(signal)
    .setHeader("Authorization", `Bearer ${accessToken}`));
  const rows = unwrapAppResult(fromSupabaseResult(response));
  if (Array.isArray(rows) && rows.length === 0) return unwrapAppResult(err("conflict"));
  const persisted = z.tuple([submittedReportSchema]).safeParse(rows);
  if (!persisted.success || persisted.data[0].id !== id) return unwrapAppResult(err("database"));
  return id;
}
