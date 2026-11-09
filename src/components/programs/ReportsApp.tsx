"use client";

import type { ReactNode } from "react";
import {
  fetchOwnReportDrafts,
  OWN_REPORT_DRAFTS_QUERY_KEY,
} from "@/components/programs/ownReportDrafts";
import { SpeciesSpecimenSelector } from "@/components/programs/SpeciesSpecimenSelector";
import { Win95Button } from "@/components/ui/Win95Button";
import { useAuthenticatedQuery } from "@/hooks/useAuthenticatedQuery";
import { toUserMessage } from "@/lib/appResult";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const updatedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function ReportsApp() {
  const drafts = useAuthenticatedQuery({
    queryKey: OWN_REPORT_DRAFTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchOwnReportDrafts(getSupabaseBrowserClient(), signal),
  });

  let draftContent: ReactNode;
  if (drafts.isPending) {
    draftContent = <p role="status">Loading drafts…</p>;
  } else if (drafts.isError) {
    draftContent = (
      <div className="flex flex-col items-start gap-1">
        <p role="alert">{toUserMessage(drafts.error)}</p>
        <Win95Button disabled={drafts.isFetching} onClick={() => { void drafts.refetch(); }}>
          Retry draft list
        </Win95Button>
      </div>
    );
  } else if (drafts.data.length === 0) {
    draftContent = <p>No drafts yet.</p>;
  } else {
    draftContent = (
      <ul
        aria-label="Report drafts"
        tabIndex={0}
        className="os-bevel-in min-h-0 flex-1 divide-y divide-gray-300 overflow-y-auto bg-[var(--os-input-bg)] px-2 text-black"
      >
        {drafts.data.map((draft) => (
          <li key={draft.id} className="py-1">
            <p className="font-bold break-words">{draft.title ?? "Untitled draft"}</p>
            <p className="text-sm">
              {draft.report_type === null ? "No type set" : <span className="capitalize">{draft.report_type}</span>}
              {" · Updated "}
              <time dateTime={draft.updated_at}>{updatedDate.format(new Date(draft.updated_at))}</time>
            </p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        <p>Choose the species this report covers. Linking a specimen is optional.</p>
        <SpeciesSpecimenSelector />
      </div>
      <section aria-label="My drafts" className="flex min-h-32 flex-1 flex-col gap-1">
        <h2 className="font-bold">My drafts</h2>
        {draftContent}
      </section>
    </div>
  );
}
