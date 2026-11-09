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
  /** Called after the selection changes, including when a list clears an invalid specimen. */
  onChange?: (selection: SubjectSelection) => void;
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

export function SpeciesSpecimenSelector({ onChange }: SpeciesSpecimenSelectorProps) {
  const access = useVerifiedAuthSnapshot();
  const [selection, setSelection] = useState<SubjectSelection>(EMPTY_SUBJECT_SELECTION);
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
  const reconciled = reduceReportSubject(activeSelection, {
    type: "records",
    species,
    response,
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

  useEffect(() => {
    onChangeRef.current?.(activeSelection);
  }, [activeSelection]);

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
  if (species.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {speciesFailure}
        <p>No species records are stored locally.</p>
      </div>
    );
  }

  const visibleSpecimens = speciesId && specimensQuery.data
    ? filterSpecimensBySpecies(specimensQuery.data, speciesId)
    : [];
  const specimenValue = visibleSpecimens.some((specimen) => specimen.id === activeSelection.specimenId)
    ? activeSelection.specimenId ?? ""
    : "";
  const specimensReady = speciesId !== null && specimensQuery.data !== undefined;
  const specimensFailed = speciesId !== null && specimensQuery.isError;
  const specimensLoading = speciesId !== null && specimensQuery.isPending && !specimensQuery.data;

  let specimenNote: ReactNode = null;
  if (specimensLoading) {
    specimenNote = <p>Loading specimens…</p>;
  } else if (specimensReady && visibleSpecimens.length === 0) {
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
          value={species.some((entry) => entry.id === activeSelection.speciesId) ? activeSelection.speciesId ?? "" : ""}
          onChange={onSpeciesChange}
          className={CONTROL_CLASS}
        >
          <option value="">Select a species</option>
          {species.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.display_name}</option>
          ))}
        </select>
      </label>
      <label htmlFor="report-specimen" className="block text-sm">
        Specimen
        <select
          id="report-specimen"
          value={specimenValue}
          disabled={speciesId === null || !specimensReady}
          aria-describedby={specimensReady && visibleSpecimens.length === 0 ? "specimen-empty" : undefined}
          onChange={onSpecimenChange}
          className={CONTROL_CLASS}
        >
          <option value="">
            {specimensLoading
              ? "Loading specimens…"
              : specimensFailed && !specimensReady
                ? "Specimens unavailable"
                : "No individual specimen"}
          </option>
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
