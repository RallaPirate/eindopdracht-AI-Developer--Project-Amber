import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppFailure, fromSupabaseResult, SAFE_ERROR_MESSAGES, unwrapAppResult } from "../../lib/appResult.ts";

/** Scope passed to useAuthenticatedQuery and to authenticated invalidation. */
export const OWN_REPORT_DRAFTS_QUERY_KEY = ["reports", "own-drafts"] as const;

const DRAFT_COLUMNS = "id, title, report_type, species_id, updated_at";
const PAGE_SIZE = 1000;

const draftListSchema = z.array(z.object({
  id: z.guid(),
  title: z.string().nullable(),
  report_type: z.enum(["care", "behaviour", "medical", "security", "incident"]).nullable(),
  species_id: z.guid(),
  updated_at: z.iso.datetime({ offset: true }),
}));

type ReportDraft = z.infer<typeof draftListSchema>[number];

export async function fetchOwnReportDrafts(
  supabase: SupabaseClient,
  signal: AbortSignal,
): Promise<ReportDraft[]> {
  const drafts: ReportDraft[] = [];

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

    drafts.push(...page.data);
    if (page.data.length < PAGE_SIZE) return drafts;
  }
}
