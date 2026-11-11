"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  createReportDraft,
  newReportDraftSchema,
  syncOwnReportDrafts,
  validateDraftSubject,
  type NewReportDraft,
} from "@/components/programs/createReportDraft";
import { deleteReportDraft, syncRemovedOwnReportDraft } from "@/components/programs/deleteReportDraft";
import {
  fetchReportDraftDetail,
  reportDraftDetailQueryKey,
  syncEditedReportDraft,
  updateReportDraft,
  type ReportDraftDetail,
} from "@/components/programs/editReportDraft";
import {
  fetchOwnReportDrafts,
  OWN_REPORT_DRAFTS_QUERY_KEY,
  REPORT_TYPES,
} from "@/components/programs/ownReportDrafts";
import { SpeciesSpecimenSelector } from "@/components/programs/SpeciesSpecimenSelector";
import { EMPTY_SUBJECT_SELECTION } from "@/components/programs/specimenSelection";
import { submitReportDraft } from "@/components/programs/submitReportDraft";
import { Win95Button } from "@/components/ui/Win95Button";
import { useAuthenticatedMutation, useAuthenticatedQuery, useVerifiedAuthSnapshot } from "@/hooks/useAuthenticatedQuery";
import { AppFailure, toUserMessage } from "@/lib/appResult";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const updatedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const CONTROL_CLASS =
  "os-bevel-in mt-1 block w-full bg-[var(--os-input-bg)] px-2 py-1 font-sans text-sm text-black";

function draftText(value: FormDataEntryValue | null, initial: string | null | undefined) {
  // Textareas display line endings as LF. Preserve the stored text if untouched.
  return initial != null && value === initial.replace(/\r\n?/g, "\n") ? initial : value;
}

type ReportDraftFormProps = {
  draft?: ReportDraftDetail;
  saving: boolean;
  feedback: ReactNode;
  onSave: (draft: NewReportDraft | null) => void;
  savedDraft?: ReportDraftDetail;
  onRequestSubmission?: (draft: ReportDraftDetail) => void;
};

function ReportDraftForm({ draft, saving, feedback, onSave, savedDraft, onRequestSubmission }: ReportDraftFormProps) {
  // Seed once per editor. Background reads must not overwrite local input.
  const [initial] = useState(draft);
  const [initialSelection] = useState(() => draft && ({
    speciesId: draft.species_id, specimenId: draft.specimen_id,
  }));
  const selection = useRef(initialSelection ?? EMPTY_SUBJECT_SELECTION);
  const [subjectAvailable, setSubjectAvailable] = useState(!initialSelection);
  const [saveRequired, setSaveRequired] = useState(false);

  function requestSubmission(form: HTMLFormElement | null) {
    const persisted = savedDraft ?? initial;
    if (!form || !persisted || saving) return;

    const fields = new window.FormData(form);
    const unchanged = selection.current.speciesId === persisted.species_id
      && selection.current.specimenId === persisted.specimen_id
      && (fields.get("report_type") || null) === persisted.report_type
      && draftText(fields.get("title"), persisted.title) === (persisted.title ?? "")
      && draftText(fields.get("body"), persisted.body) === (persisted.body ?? "");
    setSaveRequired(!unchanged);
    if (unchanged) onRequestSubmission?.(persisted);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !subjectAvailable) return;

    setSaveRequired(false);
    const fields = new window.FormData(event.currentTarget);
    const result = newReportDraftSchema.safeParse({
      species_id: selection.current.speciesId,
      specimen_id: selection.current.specimenId,
      report_type: fields.get("report_type") || null,
      title: draftText(fields.get("title"), initial?.title),
      body: draftText(fields.get("body"), initial?.body),
    });
    onSave(result.success ? result.data : null);
  }

  return (
    <form onSubmit={onSubmit} className="max-h-[65%] min-h-0 shrink-0 overflow-y-auto">
      <h2 className="font-bold">{initial ? "Edit report draft" : "Create a report draft"}</h2>
      <p className="mb-2">Choose a species. Specimen, type, title and body are optional.</p>
      <fieldset
        disabled={saving}
        className="grid min-w-0 grid-cols-2 gap-3"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <SpeciesSpecimenSelector initialSelection={initialSelection} onChange={(value, available) => {
            selection.current = value;
            setSubjectAvailable(available);
          }} />
          <label className="block text-sm">
            Report type
            <select name="report_type" className={CONTROL_CLASS} defaultValue={initial?.report_type ?? ""}>
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
            {initial ? (
              <textarea name="title" rows={1} className={`${CONTROL_CLASS} resize-y`} defaultValue={initial.title ?? ""} />
            ) : (
              <input name="title" type="text" className={CONTROL_CLASS} />
            )}
          </label>
          <label className="block text-sm">
            Body
            <textarea name="body" rows={4} className={`${CONTROL_CLASS} resize-y`} defaultValue={initial?.body ?? ""} />
          </label>
        </div>
      </fieldset>
      <div className="mt-2 flex items-center gap-2">
        <Win95Button type="submit" disabled={saving || !subjectAvailable}>
          {initial ? "Save changes" : "Save draft"}
        </Win95Button>
        {onRequestSubmission ? (
          <Win95Button disabled={saving} onClick={(event) => requestSubmission(event.currentTarget.form)}>
            Submit report
          </Win95Button>
        ) : null}
        {saveRequired ? <p role="alert">Save changes before submitting this report.</p> : null}
        {feedback}
      </div>
    </form>
  );
}

const DRAFT_UNAVAILABLE = "This draft is no longer available.";

function draftUnavailable(error: unknown) {
  return error instanceof AppFailure && (error.code === "not_found" || error.code === "unauthorized");
}

function submissionErrorMessage(error: unknown) {
  if (error instanceof AppFailure && error.code === "validation") {
    return "Save a species, report type, title and body before submitting.";
  }
  if (error instanceof AppFailure && error.code === "conflict") {
    return "This draft changed or is no longer available. Reopen it to check the latest version.";
  }
  return toUserMessage(error);
}

function ReportDraftEditor({ reportId, onBack, onDelete, onSubmitReport, deleting, submitting, ...formProps }: Omit<ReportDraftFormProps, "draft" | "onRequestSubmission"> & {
  reportId: string;
  onBack: () => void;
  onDelete: () => void;
  onSubmitReport: (draft: ReportDraftDetail) => void;
  deleting: boolean;
  submitting: boolean;
}) {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [confirmation, setConfirmation] = useState<"delete" | ReportDraftDetail | null>(null);
  const busy = formProps.saving || deleting || submitting;
  const detail = useAuthenticatedQuery({
    queryKey: reportDraftDetailQueryKey(reportId),
    refetchOnMount: "always",
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => fetchReportDraftDetail(getSupabaseBrowserClient(), reportId, signal),
  });

  // Each opening has its own observer. A failed refetch can leave old data in
  // the cache, so only a successful post-mount read can initialise the form.
  if (!hasLoaded && detail.isFetchedAfterMount && detail.isSuccess && detail.data) {
    setHasLoaded(true);
  }
  const unavailable = detail.isFetchedAfterMount && (
    (detail.isSuccess && detail.data === null) || draftUnavailable(detail.error)
  );
  const failed = detail.isFetchedAfterMount && detail.isError && !unavailable;
  const showForm = hasLoaded && !unavailable && detail.data;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Win95Button disabled={busy} onClick={onBack}>Back to new draft</Win95Button>
        {!hasLoaded && !unavailable && (!failed || detail.isFetching) ? (
          <p role="status">Loading draft…</p>
        ) : null}
        {unavailable ? <p role="status">{DRAFT_UNAVAILABLE}</p> : null}
        {failed ? (
          <>
            <p role="alert">Could not load draft. {toUserMessage(detail.error)}</p>
            <Win95Button disabled={detail.isFetching} onClick={() => { void detail.refetch(); }}>
              Retry draft
            </Win95Button>
          </>
        ) : null}
      </div>
      {showForm ? (
        <>
          <ReportDraftForm
            draft={showForm}
            {...formProps}
            saving={busy || confirmation !== null}
            onRequestSubmission={setConfirmation}
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {confirmation ? (
              <>
                <p>{confirmation === "delete"
                  ? "Delete this draft permanently?"
                  : "Submit this report for review? You can no longer edit it after submission."}</p>
                <Win95Button disabled={busy} onClick={() => {
                  setConfirmation(null);
                  if (confirmation === "delete") onDelete();
                  else onSubmitReport(confirmation);
                }}>{confirmation === "delete" ? "Confirm delete" : "Confirm submission"}</Win95Button>
                <Win95Button onClick={() => setConfirmation(null)}>Cancel</Win95Button>
              </>
            ) : (
              <Win95Button disabled={busy} onClick={() => setConfirmation("delete")}>
                Delete draft
              </Win95Button>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

function ReportsWorkspace({ ready }: { ready: boolean }) {
  const [reportId, setReportId] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [savedDraft, setSavedDraft] = useState<ReportDraftDetail>();
  const writePending = useRef(false);
  const drafts = useAuthenticatedQuery({
    queryKey: OWN_REPORT_DRAFTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchOwnReportDrafts(getSupabaseBrowserClient(), signal),
  });
  const save = useAuthenticatedMutation({
    mutationKey: ["reports", "save-draft"],
    mutationFn: async ({ id, draft }: { id: string | null; draft: NewReportDraft }, context) => {
      const supabase = getSupabaseBrowserClient();
      return id === null
        ? { mode: "create" as const, draft: await createReportDraft(supabase, draft, context) }
        : { mode: "edit" as const, draft: await updateReportDraft(supabase, id, draft, context) };
    },
    retry: false,
    gcTime: 0,
    onMutate: ({ draft }, context) => validateDraftSubject(draft, context),
    onSuccess: (saved, _variables, _result, context) => {
      if (saved.mode === "create") syncOwnReportDrafts(saved.draft, context);
      else syncEditedReportDraft(saved.draft, context);
    },
  });
  const remove = useAuthenticatedMutation({
    mutationKey: ["reports", "delete-draft"],
    mutationFn: (id: string, context) => deleteReportDraft(getSupabaseBrowserClient(), id, context),
    retry: false,
    gcTime: 0,
    onSuccess: (id, _variables, _result, context) => syncRemovedOwnReportDraft(id, context),
  });
  const submit = useAuthenticatedMutation({
    mutationKey: ["reports", "submit-draft"],
    mutationFn: (draft: ReportDraftDetail, context) => submitReportDraft(getSupabaseBrowserClient(), draft, context),
    retry: false,
    gcTime: 0,
    onSuccess: (id, _variables, _result, context) => syncRemovedOwnReportDraft(id, context),
  });
  const busy = save.isPending || remove.isPending || submit.isPending;

  function openDraft(id: string | null) {
    if (writePending.current || busy || id === reportId) return;
    save.reset();
    remove.reset();
    submit.reset();
    setSavedDraft(undefined);
    setInvalid(false);
    setReportId(id);
  }

  function onSave(draft: NewReportDraft | null) {
    if (writePending.current || busy) return;
    remove.reset();
    submit.reset();
    setInvalid(draft === null);
    if (!draft) {
      save.reset();
      return;
    }
    writePending.current = true;
    save.mutate({ id: reportId, draft }, {
      onSuccess: (saved) => {
        if (saved.mode === "create") setFormVersion((version) => version + 1);
        else setSavedDraft(saved.draft);
      },
      onSettled: () => { writePending.current = false; },
    });
  }

  function onDelete() {
    if (!reportId || writePending.current || busy) return;
    writePending.current = true;
    save.reset();
    submit.reset();
    setInvalid(false);
    remove.mutate(reportId, {
      onSuccess: (id) => setReportId((current) => current === id ? null : current),
      onSettled: () => { writePending.current = false; },
    });
  }

  function onSubmitReport(draft: ReportDraftDetail) {
    if (draft.id !== reportId || writePending.current || busy) return;
    writePending.current = true;
    save.reset();
    remove.reset();
    setInvalid(false);
    void submit.mutateAsync(draft, {
      onSuccess: (id) => setReportId((current) => current === id ? null : current),
    }).catch(() => {}).finally(() => { writePending.current = false; });
  }

  const editing = reportId !== null;
  let feedback: ReactNode = null;
  if (remove.isPending) {
    feedback = <p role="status">Deleting draft…</p>;
  } else if (remove.isError) {
    const message = draftUnavailable(remove.error) ? DRAFT_UNAVAILABLE : toUserMessage(remove.error);
    feedback = <p role="alert">Could not delete draft. {message}</p>;
  } else if (remove.isSuccess && !editing) {
    feedback = <p role="status">Draft deleted.</p>;
  } else if (save.isPending) {
    feedback = <p role="status">{editing ? "Saving changes…" : "Saving draft…"}</p>;
  } else if (save.isSuccess) {
    feedback = <p role="status">{editing ? "Changes saved." : "Draft saved."}</p>;
  } else if (invalid) {
    feedback = <p role="alert">Choose a valid species and check the draft fields.</p>;
  } else if (save.isError) {
    const message = editing && draftUnavailable(save.error) ? DRAFT_UNAVAILABLE : toUserMessage(save.error);
    feedback = <p role="alert">Could not save {editing ? "changes" : "draft"}. {message}</p>;
  }

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
            <p className="font-bold break-words">
              <button
                type="button"
                className="max-w-full cursor-pointer text-left underline disabled:cursor-default disabled:no-underline"
                aria-current={reportId === draft.id ? "true" : undefined}
                disabled={busy}
                onClick={() => openDraft(draft.id)}
              >
                {draft.title?.trim() ? draft.title : "Untitled draft"}
              </button>
            </p>
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
      {submit.isPending ? <p role="status">Submitting report…</p> : null}
      {submit.isSuccess ? <p role="status">Report submitted for review.</p> : null}
      {submit.isError ? (
        <p role="alert">Could not submit report. {submissionErrorMessage(submit.error)}</p>
      ) : null}
      {ready && reportId !== null ? (
        <ReportDraftEditor
          key={reportId}
          reportId={reportId}
          onBack={() => openDraft(null)}
          onDelete={onDelete}
          onSubmitReport={onSubmitReport}
          deleting={remove.isPending}
          submitting={submit.isPending}
          saving={save.isPending}
          savedDraft={savedDraft}
          feedback={feedback}
          onSave={onSave}
        />
      ) : ready ? (
        <ReportDraftForm
          key={formVersion}
          saving={save.isPending}
          feedback={feedback}
          onSave={onSave}
        />
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

export function ReportsApp() {
  const access = useVerifiedAuthSnapshot();
  return (
    <ReportsWorkspace key={`${access.userId}:${access.accessEpoch}:${access.status}`} ready={access.status === "ready"} />
  );
}
