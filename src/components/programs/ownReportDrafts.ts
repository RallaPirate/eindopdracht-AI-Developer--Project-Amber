import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppFailure, fromSupabaseResult, SAFE_ERROR_MESSAGES, unwrapAppResult } from "../../lib/appResult.ts";

/** Scope passed to useAuthenticatedQuery and to authenticated invalidation. */
export const OWN_REPORT_DRAFTS_QUERY_KEY = ["reports", "own-drafts"] as const;

export const DRAFT_COLUMNS = "id, title, report_type, species_id, updated_at";
const PAGE_SIZE = 1000;

export const REPORT_TYPES = ["care", "behaviour", "medical", "security", "incident"] as const;

export const reportDraftSchema = z.object({
  id: z.guid(),
  title: z.string().nullable(),
  report_type: z.enum(REPORT_TYPES).nullable(),
  species_id: z.guid(),
  updated_at: z.iso.datetime({ offset: true }),
});

const draftListSchema = z.array(reportDraftSchema);
export type ReportDraft = z.infer<typeof reportDraftSchema>;

function subMilliseconds(timestamp: string): number {
  // Date.parse truncates to milliseconds, while Postgres stores microseconds.
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? "";
  return Number(fraction.padEnd(6, "0").slice(3, 6));
}

export function compareReportDrafts(a: ReportDraft, b: ReportDraft): number {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at)
    || subMilliseconds(b.updated_at) - subMilliseconds(a.updated_at)
    || a.id.localeCompare(b.id);
}

export async function fetchOwnReportDrafts(
  supabase: SupabaseClient,
  signal: AbortSignal,
): Promise<ReportDraft[]> {
  const draftsById = new Map<string, ReportDraft>();

  // RLS resolves ownership using the internal profile id. The status filters
  // also exclude reports visible through the submitted and reviewed policies.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await supabase
      .from("reports")
      .select(DRAFT_COLUMNS)
      .eq("review_status", "draft")
      .eq("record_status", "active")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(signal);

    const page = draftListSchema.safeParse(unwrapAppResult(fromSupabaseResult(response)));
    if (!page.success) {
      throw new AppFailure({ code: "validation", message: SAFE_ERROR_MESSAGES.validation });
    }

    // An INSERT or update between offset reads can move a row onto a later page.
    for (const draft of page.data) draftsById.set(draft.id, draft);
    if (page.data.length < PAGE_SIZE) {
      return [...draftsById.values()].sort(compareReportDrafts);
    }
  }
}
