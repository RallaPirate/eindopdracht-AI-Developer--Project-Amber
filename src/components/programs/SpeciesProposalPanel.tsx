"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Win95Button } from "@/components/ui/Win95Button";
import {
  useAuthenticatedMutation,
  useVerifiedAuthSnapshot,
} from "@/hooks/useAuthenticatedQuery";
import { requestAuthQuerySync, requestFreshAuthQuerySync } from "@/lib/authQueryIsolation";
import { EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH } from "@/lib/externalSpecies";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import {
  acceptedSpeciesSelection,
  canOfferSpeciesProposal,
  isSpeciesLookupAccessDenial,
  requestSpeciesNameLookup,
  sameManagementAccess,
  SPECIES_LOOKUP_MUTATION_KEY,
  SPECIES_PROPOSAL_COPY,
  speciesLookupAccessOwns,
  speciesLookupMessage,
  visibleConfirmedSpecies,
  visibleSpeciesMatches,
  type HeldSpeciesSelection,
  type OwnedSpeciesLookup,
} from "@/components/programs/speciesProposalView";

/**
 * Deterministic Management lookup. It does not call a language model
 * and does not keep the selected id outside this component.
 */
export function SpeciesProposalPanel() {
  const access = useVerifiedAuthSnapshot();
  const [name, setName] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<HeldSpeciesSelection | null>(null);
  const [owned, setOwned] = useState<OwnedSpeciesLookup | null>(null);
  const nameRef = useRef(name);
  const proposalGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lookup = useAuthenticatedMutation({
    mutationKey: SPECIES_LOOKUP_MUTATION_KEY,
    retry: false,
    gcTime: 0,
    mutationFn: (speciesName: string) => requestSpeciesNameLookup(speciesName),
  });

  if (owned && !speciesLookupAccessOwns(owned, access)) {
    setOwned(null);
    setChosenId(null);
  }
  if (
    confirmed &&
    (confirmed.userId !== access.userId ||
      confirmed.accessEpoch !== access.accessEpoch ||
      !canOfferSpeciesProposal(access))
  ) {
    setConfirmed(null);
  }

  const offered = canOfferSpeciesProposal(access);
  const lookupCurrent =
    speciesLookupAccessOwns(owned, access) && owned.submittedName === name;
  const matches = visibleSpeciesMatches(owned, access, name);
  const shown = visibleConfirmedSpecies(confirmed, access);
  const chosen = matches.find((match) => match.external_species_id === chosenId) ?? null;
  const errorMessage =
    offered && lookup.isError ? speciesLookupMessage(lookup.error) : null;

  function discardTransient() {
    proposalGeneration.current += 1;
    setOwned(null);
    setChosenId(null);
    setConfirmed(null);
    lookup.reset();
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = getVerifiedAuthSnapshot();
    if (
      !canOfferSpeciesProposal(current) ||
      current.userId === null ||
      access.userId !== current.userId ||
      access.accessEpoch !== current.accessEpoch
    ) {
      return;
    }
    const generation = proposalGeneration.current + 1;
    proposalGeneration.current = generation;
    const initiated = {
      userId: current.userId,
      accessEpoch: current.accessEpoch,
      submittedName: name,
    };
    setChosenId(null);
    setConfirmed(null);
    setOwned(null);
    lookup.mutate(name, {
      onSuccess: (data) => {
        if (!mounted.current || proposalGeneration.current !== generation) return;
        if (nameRef.current !== initiated.submittedName) return;
        const after = getVerifiedAuthSnapshot();
        if (
          after.userId !== initiated.userId ||
          after.accessEpoch !== initiated.accessEpoch ||
          !canOfferSpeciesProposal(after)
        ) {
          return;
        }
        setOwned({
          userId: initiated.userId,
          accessEpoch: initiated.accessEpoch,
          submittedName: initiated.submittedName,
          matches: data,
        });
      },
      onError: (error) => {
        if (!mounted.current || proposalGeneration.current !== generation) return;
        if (!isSpeciesLookupAccessDenial(error)) return;
        setOwned(null);
        setChosenId(null);
        setConfirmed(null);
        void requestAuthQuerySync();
      },
    });
  }

  async function onConfirm() {
    // This handler can run before React commits a new access epoch.
    // Rows keep the epoch that accepted them and are never relabelled.
    const generation = proposalGeneration.current + 1;
    proposalGeneration.current = generation;
    const started = getVerifiedAuthSnapshot();
    const pending = acceptedSpeciesSelection(owned, chosenId, started, name);
    if (!pending) {
      if (owned && !speciesLookupAccessOwns(owned, started)) discardTransient();
      return;
    }
    const verified = await requestFreshAuthQuerySync();
    if (!mounted.current || proposalGeneration.current !== generation) return;
    const after = getVerifiedAuthSnapshot();
    if (!verified || !sameManagementAccess(started, verified, after)) {
      discardTransient();
      return;
    }
    const still = acceptedSpeciesSelection(owned, chosenId, after, name);
    if (!still) {
      discardTransient();
      return;
    }
    setConfirmed(still);
    setChosenId(null);
  }

  function onSearchAgain() {
    discardTransient();
  }

  function onNameChange(next: string) {
    nameRef.current = next;
    setName(next);
    if (next === name) return;
    proposalGeneration.current += 1;
    setOwned(null);
    setChosenId(null);
    setConfirmed(null);
    lookup.reset();
  }

  if (!offered) return null;

  return (
    <form className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" onSubmit={onSearch}>
      <p>
        <span className="font-bold">{SPECIES_PROPOSAL_COPY.assistant}: </span>
        &quot;{SPECIES_PROPOSAL_COPY.prompt}&quot;
      </p>

      <label className="block">
        <span className="mb-1 block">Species name</span>
        <input
          type="text"
          name="species-name"
          value={name}
          maxLength={EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH}
          onChange={(event) => onNameChange(event.target.value)}
          className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none"
        />
      </label>

      <div className="flex gap-2">
        <Win95Button type="submit" disabled={lookup.isPending}>
          {SPECIES_PROPOSAL_COPY.search}
        </Win95Button>
        {shown || lookupCurrent ? (
          <Win95Button type="button" onClick={onSearchAgain} disabled={lookup.isPending}>
            {SPECIES_PROPOSAL_COPY.searchAgain}
          </Win95Button>
        ) : null}
      </div>

      {lookup.isPending ? (
        <p role="status">{SPECIES_PROPOSAL_COPY.searching}</p>
      ) : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}

      {matches.length > 0 && !shown ? (
        <fieldset className="os-bevel-in min-w-0 p-2">
          <legend className="px-1">
            {matches.length === 1
              ? SPECIES_PROPOSAL_COPY.oneMatch
              : SPECIES_PROPOSAL_COPY.manyMatches}
          </legend>
          <div className="flex flex-col gap-1">
            {matches.map((match) => {
              const selected = chosenId === match.external_species_id;
              return (
                <label
                  key={match.external_species_id}
                  className="flex items-start gap-2 break-words"
                >
                  <input
                    type="radio"
                    name="species-match"
                    value={match.external_species_id}
                    checked={selected}
                    onChange={() => setChosenId(match.external_species_id)}
                  />
                  <span>
                    <span className="whitespace-pre-wrap">{match.scientific_name}</span>
                    <span className="block">External ID {match.external_species_id}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <Win95Button
            type="button"
            className="mt-2"
            disabled={chosen === null}
            onClick={onConfirm}
          >
            {SPECIES_PROPOSAL_COPY.confirm}
          </Win95Button>
        </fieldset>
      ) : null}

      {lookupCurrent && matches.length === 0 && !shown && !lookup.isPending ? (
        <p>{SPECIES_PROPOSAL_COPY.none}</p>
      ) : null}

      {shown ? (
        <div className="os-bevel-in p-2" aria-live="polite">
          <p className="font-bold">{SPECIES_PROPOSAL_COPY.selected}</p>
          <p>
            <span className="font-bold">{SPECIES_PROPOSAL_COPY.scientificName} </span>
            <span className="whitespace-pre-wrap">{shown.scientific_name}</span>
          </p>
          <p>
            <span className="font-bold">{SPECIES_PROPOSAL_COPY.externalId} </span>
            <span>{shown.external_species_id}</span>
          </p>
        </div>
      ) : null}
    </form>
  );
}
