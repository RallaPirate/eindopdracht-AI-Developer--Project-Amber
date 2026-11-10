"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  createReportDraft,
  newReportDraftSchema,
  syncOwnReportDrafts,
  validateDraftSubject,
} from "@/components/programs/createReportDraft";
import {
  fetchOwnReportDrafts,
  OWN_REPORT_DRAFTS_QUERY_KEY,
  REPORT_TYPES,
} from "@/components/programs/ownReportDrafts";
import { SpeciesSpecimenSelector } from "@/components/programs/SpeciesSpecimenSelector";
import { EMPTY_SUBJECT_SELECTION } from "@/components/programs/specimenSelection";
import { Win95Button } from "@/components/ui/Win95Button";
import { useAuthenticatedMutation, useAuthenticatedQuery, useVerifiedAuthSnapshot } from "@/hooks/useAuthenticatedQuery";
import { toUserMessage } from "@/lib/appResult";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const updatedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const CONTROL_CLASS =
  "os-bevel-in mt-1 block w-full bg-[var(--os-input-bg)] px-2 py-1 font-sans text-sm text-black";

function ReportDraftForm() {
  const selection = useRef(EMPTY_SUBJECT_SELECTION);
  const saving = useRef(false);
  const [formVersion, setFormVersion] = useState(0);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const save = useAuthenticatedMutation({
    mutationKey: ["reports", "create-draft"],
    mutationFn: (draft, context) =>
      createReportDraft(getSupabaseBrowserClient(), draft, context),
    retry: false,
    gcTime: 0,
    onMutate: validateDraftSubject,
    onSuccess: (draft, _variables, _result, context) => syncOwnReportDrafts(draft, context),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || save.isPending) return;

    const fields = new window.FormData(event.currentTarget);
    const draft = newReportDraftSchema.safeParse({
      species_id: selection.current.speciesId,
      specimen_id: selection.current.specimenId,
      report_type: fields.get("report_type") || null,
      title: fields.get("title"),
      body: fields.get("body"),
    });
    if (!draft.success) {
      save.reset();
      setValidationMessage("Choose a valid species and check the draft fields.");
      return;
    }

    setValidationMessage(null);
    saving.current = true;
    save.mutate(draft.data, {
      onSuccess: () => {
        selection.current = EMPTY_SUBJECT_SELECTION;
        setFormVersion((version) => version + 1);
      },
      onSettled: () => { saving.current = false; },
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-h-[65%] min-h-0 shrink-0 overflow-y-auto">
      <h2 className="font-bold">Create a report draft</h2>
      <p className="mb-2">Choose a species. Specimen, type, title and body are optional.</p>
      <fieldset
        key={formVersion}
        disabled={save.isPending}
        className="grid min-w-0 grid-cols-2 gap-3"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <SpeciesSpecimenSelector onChange={(value) => { selection.current = value; }} />
          <label className="block text-sm">
            Report type
            <select name="report_type" className={CONTROL_CLASS} defaultValue="">
              <option value="">No type set</option>
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <label className="block text-sm">
            Title
            <input name="title" type="text" className={CONTROL_CLASS} />
          </label>
          <label className="block text-sm">
            Body
            <textarea name="body" rows={4} className={`${CONTROL_CLASS} resize-y`} />
          </label>
        </div>
      </fieldset>
      <div className="mt-2 flex items-center gap-2">
        <Win95Button type="submit" disabled={save.isPending}>Save draft</Win95Button>
        {save.isPending ? <p role="status">Saving draft…</p> : null}
        {save.isSuccess ? <p role="status">Draft saved.</p> : null}
        {validationMessage || save.isError ? (
          <p role="alert">{validationMessage ?? `Could not save draft. ${toUserMessage(save.error)}`}</p>
        ) : null}
      </div>
    </form>
  );
}

export function ReportsApp() {
  const access = useVerifiedAuthSnapshot();
  const drafts = useAuthenticatedQuery({
    queryKey: OWN_REPORT_DRAFTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchOwnReportDrafts(getSupabaseBrowserClient(), signal),
  });

  let draftContent: ReactNode;
  if (drafts.isPending) {
    draftContent = <p role="status">Loading drafts…</p>;
  } else if (!drafts.data) {
    draftContent = null;
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
      {access.status === "ready" ? (
        <ReportDraftForm key={`${access.userId}:${access.accessEpoch}`} />
      ) : null}
      <section aria-label="My drafts" className="flex min-h-32 flex-1 flex-col gap-1">
        <h2 className="font-bold">My drafts</h2>
        {drafts.isError ? (
          <div className="flex flex-col items-start gap-1">
            <p role="alert">{toUserMessage(drafts.error)}</p>
            <Win95Button disabled={drafts.isFetching} onClick={() => { void drafts.refetch(); }}>
              Retry draft list
            </Win95Button>
          </div>
        ) : null}
        {draftContent}
      </section>
    </div>
  );
}
