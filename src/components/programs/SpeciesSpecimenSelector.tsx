"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useAuthenticatedQuery, useVerifiedAuthSnapshot } from "@/hooks/useAuthenticatedQuery";
import { AppFailure, SAFE_ERROR_MESSAGES, toUserMessage } from "@/lib/appResult";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { Win95Button } from "@/components/ui/Win95Button";
import {
  fetchLocalSpecies,
  SPECIES_DATABASE_QUERY_KEY,
} from "@/components/programs/speciesDatabaseView";
import {
  EMPTY_SUBJECT_SELECTION,
  fetchSpecimensForSpecies,
  filterSpecimensBySpecies,
  reduceReportSubject,
  specimenOptionLabel,
  SPECIMENS_IDLE_QUERY_KEY,
  specimensForSpeciesQueryKey,
  type SubjectSelection,
} from "@/components/programs/specimenSelection";

const CONTROL_CLASS =
  "os-bevel-in mt-1 block w-full bg-[var(--os-input-bg)] px-2 py-1 font-sans text-sm text-black outline-none disabled:text-[var(--os-disabled)]";

type SpeciesSpecimenSelectorProps = {
  /** Mount a new selector for each edited draft and authentication lifetime. */
  initialSelection?: SubjectSelection;
  /** Edit mode also reports whether the current subject appears in the loaded lists. */
  onChange?: (selection: SubjectSelection, subjectAvailable: boolean) => void;
};

function retryQuery(refetch: () => Promise<unknown>) {
  void refetch().catch(() => {});
}

function RetrievalFailure({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p role="alert">{message}</p>
      <Win95Button type="button" onClick={onRetry}>{retryLabel}</Win95Button>
    </div>
  );
}

export function SpeciesSpecimenSelector({ initialSelection, onChange }: SpeciesSpecimenSelectorProps) {
  const access = useVerifiedAuthSnapshot();
  const [selection, setSelection] = useState(initialSelection ?? EMPTY_SUBJECT_SELECTION);
  const [session, setSession] = useState({
    userId: access.userId,
    accessEpoch: access.accessEpoch,
  });
  const sessionChanged = session.userId !== access.userId
    || session.accessEpoch !== access.accessEpoch;
  if (sessionChanged) {
    setSession({ userId: access.userId, accessEpoch: access.accessEpoch });
    setSelection(EMPTY_SUBJECT_SELECTION);
  }
  const activeSelection = sessionChanged ? EMPTY_SUBJECT_SELECTION : selection;
  const onChangeRef = useRef(onChange);
  const speciesQuery = useAuthenticatedQuery({
    queryKey: SPECIES_DATABASE_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchLocalSpecies(getSupabaseBrowserClient(), signal),
  });
  const speciesId = activeSelection.speciesId;
  const specimensQuery = useAuthenticatedQuery({
    queryKey: speciesId
      ? specimensForSpeciesQueryKey(speciesId)
      : SPECIMENS_IDLE_QUERY_KEY,
    enabled: speciesId !== null,
    queryFn: ({ signal, queryKey }) => {
      const requestedSpeciesId = queryKey[queryKey.length - 1];
      if (typeof requestedSpeciesId !== "string") {
        throw new AppFailure({
          code: "validation",
          message: SAFE_ERROR_MESSAGES.validation,
        });
      }
      return fetchSpecimensForSpecies(
        getSupabaseBrowserClient(),
        requestedSpeciesId,
        signal,
      );
    },
  });

  const species = speciesQuery.data;
  const response = speciesId !== null && specimensQuery.data
    ? { speciesId, specimens: specimensQuery.data }
    : null;
  // In the editor, only explicit input may change a persisted subject.
  const reconciled = initialSelection ? activeSelection : reduceReportSubject(activeSelection, {
    type: "records", species, response,
  });
  if (
    !sessionChanged && (
      reconciled.speciesId !== selection.speciesId ||
      reconciled.specimenId !== selection.specimenId
    )
  ) {
    setSelection(reconciled);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const visibleSpecimens = speciesId && specimensQuery.data
    ? filterSpecimensBySpecies(specimensQuery.data, speciesId)
    : [];
  const speciesAvailable = species?.some((entry) => entry.id === speciesId) ?? false;
  const specimenId = activeSelection.specimenId;
  const specimenAvailable = specimenId === null || visibleSpecimens.some((entry) => entry.id === specimenId);
  const subjectAvailable = !initialSelection || (speciesAvailable && specimenAvailable);

  useEffect(() => {
    onChangeRef.current?.(activeSelection, subjectAvailable);
  }, [activeSelection, subjectAvailable]);

  function onSpeciesChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    // Clear an incompatible specimen in this update, before the next list arrives.
    setSelection((current) =>
      reduceReportSubject(current, {
        type: "species",
        speciesId: nextId.length > 0 ? nextId : null,
      }),
    );
  }

  function onSpecimenChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    const specimens = specimensQuery.data ?? [];
    setSelection((current) =>
      reduceReportSubject(current, {
        type: "specimen",
        specimenId: nextId.length > 0 ? nextId : null,
        specimens,
      }),
    );
  }

  const speciesFailure = speciesQuery.isError ? (
    <RetrievalFailure
      message={toUserMessage(speciesQuery.error)}
      retryLabel="Retry species list"
      onRetry={() => retryQuery(speciesQuery.refetch)}
    />
  ) : null;

  if (speciesQuery.isPending && !species) {
    return <p>Loading species records…</p>;
  }
  if (!species) {
    return speciesFailure;
  }
  if (species.length === 0 && !initialSelection) {
    return (
      <div className="flex flex-col gap-2">
        {speciesFailure}
        <p>No species records are stored locally.</p>
      </div>
    );
  }

  const missingSpecies = !!initialSelection && speciesId !== null && !speciesAvailable;
  const missingSpecimen = !!initialSelection && !specimenAvailable;
  const specimensReady = speciesId !== null && specimensQuery.data !== undefined;
  const specimensFailed = speciesId !== null && specimensQuery.isError;
  const specimensLoading = speciesId !== null && specimensQuery.isPending && !specimensQuery.data;
  const noSpecimens = specimensReady && visibleSpecimens.length === 0 && !missingSpecimen;

  let specimenNote: ReactNode = null;
  if (specimensLoading) {
    specimenNote = <p>Loading specimens…</p>;
  } else if (missingSpecimen) {
    specimenNote = (
      <div className="flex flex-col items-start gap-1">
        <p role="alert">The selected specimen could not be verified. Retry or explicitly choose a different specimen or no specimen.</p>
        {!specimensFailed ? (
          <Win95Button disabled={specimensQuery.isFetching} onClick={() => retryQuery(specimensQuery.refetch)}>
            Retry specimen list
          </Win95Button>
        ) : null}
      </div>
    );
  } else if (noSpecimens) {
    specimenNote = (
      <p id="specimen-empty">
        No specimens are recorded for this species. A report can still cover the species.
      </p>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-3">
      {speciesFailure}
      <label htmlFor="report-species" className="block text-sm">
        Species
        <select
          id="report-species"
          value={speciesAvailable || missingSpecies ? speciesId ?? "" : ""}
          onChange={onSpeciesChange}
          className={CONTROL_CLASS}
        >
          <option value="">Select a species</option>
          {missingSpecies ? <option value={speciesId}>Selected species unavailable</option> : null}
          {species.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.display_name}</option>
          ))}
        </select>
      </label>
      {initialSelection && speciesId === null ? <p>Choose a species to save changes.</p> : null}
      {missingSpecies && !speciesQuery.isError ? (
        <div className="flex flex-col items-start gap-1">
          <p role="alert">Retry the species list or choose an available species.</p>
          <Win95Button disabled={speciesQuery.isFetching} onClick={() => retryQuery(speciesQuery.refetch)}>
            Retry species list
          </Win95Button>
        </div>
      ) : null}
      <label htmlFor="report-specimen" className="block text-sm">
        Specimen
        <select
          id="report-specimen"
          value={specimenAvailable || missingSpecimen ? specimenId ?? "" : ""}
          disabled={speciesId === null || (!specimensReady && !(missingSpecimen && specimensFailed))}
          aria-describedby={noSpecimens ? "specimen-empty" : undefined}
          onChange={onSpecimenChange}
          className={CONTROL_CLASS}
        >
          <option value="">
            {specimensLoading
              ? "Loading specimens…"
              : specimensFailed && !specimensReady && !missingSpecimen
                ? "Specimens unavailable"
                : "No individual specimen"}
          </option>
          {missingSpecimen ? (
            <option value={specimenId}>{specimensLoading ? "Verifying selected specimen…" : "Selected specimen unavailable"}</option>
          ) : null}
          {visibleSpecimens.map((specimen) => (
            <option key={specimen.id} value={specimen.id}>
              {specimenOptionLabel(specimen)}
            </option>
          ))}
        </select>
      </label>
      {specimensFailed ? (
        <RetrievalFailure
          message={toUserMessage(specimensQuery.error)}
          retryLabel="Retry specimen list"
          onRetry={() => retryQuery(specimensQuery.refetch)}
        />
      ) : null}
      {specimenNote}
    </div>
  );
}
