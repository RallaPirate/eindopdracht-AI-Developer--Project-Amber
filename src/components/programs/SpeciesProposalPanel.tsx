"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  requestSpeciesAcceptance,
  requestSpeciesEnrichment,
  SpeciesAcceptanceFailure,
  type SpeciesAcceptanceRequest,
} from "@/components/programs/requestSpeciesEnrichment";
import { SPECIES_DATABASE_QUERY_KEY } from "@/components/programs/speciesDatabaseView";
import { SpeciesProposalAcceptance } from "@/components/programs/SpeciesProposalReview";
import { Win95Button } from "@/components/ui/Win95Button";
import {
  useAuthenticatedMutation,
  useVerifiedAuthSnapshot,
} from "@/hooks/useAuthenticatedQuery";
import type { SpeciesEnrichmentAcceptance } from "@/lib/ai/speciesEnrichmentSchemas";
import { isAppFailure, toUserMessage } from "@/lib/appResult";
import { requestAuthQuerySync, requestFreshAuthQuerySync } from "@/lib/authQueryIsolation";
import { EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH } from "@/lib/externalSpecies";
import { AuthenticatedQueryIdentityError } from "@/lib/queryCacheIsolation";
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

type HeldEnrichment = HeldSpeciesSelection & (
  | { status: "pending" }
  | ({ status: "ready"; generation: number } & Awaited<ReturnType<typeof requestSpeciesEnrichment>>)
  | { status: "failed" }
);

type ProposalNotice = Pick<HeldSpeciesSelection, "userId" | "accessEpoch"> & {
  kind: "error" | "success";
  message: string;
};

export function SpeciesProposalPanel() {
  const access = useVerifiedAuthSnapshot();
  const [name, setName] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldEnrichment | null>(null);
  const [notice, setNotice] = useState<ProposalNotice | null>(null);
  const [owned, setOwned] = useState<OwnedSpeciesLookup | null>(null);
  const nameRef = useRef(name);
  const proposalGeneration = useRef(0);
  const generationInFlight = useRef<HeldSpeciesSelection | null>(null);
  const saveInFlight = useRef<number | null>(null);
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
  const enrichment = useAuthenticatedMutation({
    mutationKey: ["species-enrichment"],
    retry: false,
    gcTime: 0,
    networkMode: "always",
    mutationFn: async ({ selection, generation }: {
      selection: HeldSpeciesSelection;
      generation: number;
    }) => {
      const started = getVerifiedAuthSnapshot();
      if (!isCurrentSelection(selection, generation)) {
        throw new AuthenticatedQueryIdentityError();
      }
      const proposal = await requestSpeciesEnrichment(selection.external_species_id);
      if (!isCurrentSelection(selection, generation)) {
        throw new AuthenticatedQueryIdentityError();
      }
      const verified = await requestFreshAuthQuerySync();
      if (
        !verified ||
        !sameManagementAccess(started, verified, getVerifiedAuthSnapshot()) ||
        !isCurrentSelection(selection, generation)
      ) {
        throw new AuthenticatedQueryIdentityError();
      }
      return proposal;
    },
  });
  const save = useAuthenticatedMutation({
    mutationKey: ["species-acceptance"],
    retry: false,
    gcTime: 0,
    networkMode: "always",
    mutationFn: async ({ selection, generation, request }: {
      selection: HeldSpeciesSelection;
      generation: number;
      request: SpeciesAcceptanceRequest;
    }) => {
      const started = getVerifiedAuthSnapshot();
      if (!isCurrentSelection(selection, generation)) throw new AuthenticatedQueryIdentityError();
      const verified = await requestFreshAuthQuerySync();
      if (
        !verified ||
        !sameManagementAccess(started, verified, getVerifiedAuthSnapshot()) ||
        !isCurrentSelection(selection, generation)
      ) {
        throw new AuthenticatedQueryIdentityError();
      }
      await requestSpeciesAcceptance(request);
    },
    onSuccess: (_data, _variables, _result, { cache }) => {
      void cache.invalidateQueries(SPECIES_DATABASE_QUERY_KEY);
    },
    onError: (error, _variables, _result, { cache }) => {
      if (error instanceof SpeciesAcceptanceFailure &&
        (error.reason === "unconfirmed" || error.reason === "duplicate")) {
        void cache.invalidateQueries(SPECIES_DATABASE_QUERY_KEY);
      }
    },
  });

  if (owned && !speciesLookupAccessOwns(owned, access)) {
    setOwned(null);
    setChosenId(null);
  }
  const offered = canOfferSpeciesProposal(access);
  const shown = visibleConfirmedSpecies(held, access);
  if (held && !shown) setHeld(null);
  const currentEnrichment = shown ? held : null;
  const visibleNotice =
    offered && notice?.userId === access.userId && notice.accessEpoch === access.accessEpoch
      ? notice
      : null;
  if (notice && !visibleNotice) setNotice(null);
  const lookupCurrent =
    speciesLookupAccessOwns(owned, access) && owned.submittedName === name;
  const matches = visibleSpeciesMatches(owned, access, name);
  const chosen = matches.find((match) => match.external_species_id === chosenId) ?? null;
  const errorMessage =
    offered && lookup.isError ? speciesLookupMessage(lookup.error) : null;
  const saveFailure = save.error instanceof SpeciesAcceptanceFailure ? save.error : null;
  const saveBlocked = saveFailure !== null && saveFailure.reason !== "validation";

  function discardTransient() {
    proposalGeneration.current += 1;
    setOwned(null);
    setChosenId(null);
    setHeld(null);
    setNotice(null);
    lookup.reset();
    save.reset();
  }

  function isCurrentSelection(selection: HeldSpeciesSelection, generation: number) {
    return mounted.current &&
      proposalGeneration.current === generation &&
      visibleConfirmedSpecies(selection, getVerifiedAuthSnapshot()) !== null;
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
    discardTransient();
    const generation = proposalGeneration.current;
    const initiated = {
      userId: current.userId,
      accessEpoch: current.accessEpoch,
      submittedName: name,
    };
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
        setHeld(null);
        void requestAuthQuerySync();
      },
    });
  }

  async function onConfirm() {
    // This handler can run before React commits a new access epoch.
    // Rows keep the epoch that accepted them and are never relabelled.
    const started = getVerifiedAuthSnapshot();
    if (
      visibleConfirmedSpecies(generationInFlight.current, started) ||
      (held && held.status !== "failed")
    ) return;
    const selection = held ?? acceptedSpeciesSelection(owned, chosenId, started, name);
    if (!selection || !visibleConfirmedSpecies(selection, started)) {
      if (owned && !speciesLookupAccessOwns(owned, started)) discardTransient();
      return;
    }
    const generation = ++proposalGeneration.current;
    const verified = await requestFreshAuthQuerySync();
    if (!isCurrentSelection(selection, generation)) return;
    const after = getVerifiedAuthSnapshot();
    if (!verified || !sameManagementAccess(started, verified, after)) {
      discardTransient();
      return;
    }
    generationInFlight.current = selection;
    setHeld({ ...selection, status: "pending" });
    setChosenId(null);
    try {
      const review = await enrichment.mutateAsync({ selection, generation });
      if (isCurrentSelection(selection, generation)) {
        setHeld({ ...selection, status: "ready", generation, ...review });
      }
    } catch (error) {
      if (!isCurrentSelection(selection, generation)) return;
      const accessDenied =
        isAppFailure(error) && (error.code === "unauthenticated" || error.code === "unauthorized");
      if (accessDenied || error instanceof AuthenticatedQueryIdentityError) {
        discardTransient();
        setNotice({
          kind: "error",
          userId: selection.userId,
          accessEpoch: selection.accessEpoch,
          message: accessDenied
            ? toUserMessage(error)
            : "Unable to verify access to the species proposal. Please search again.",
        });
        if (accessDenied) void requestAuthQuerySync();
      } else {
        setHeld({ ...selection, status: "failed" });
      }
      return;
    } finally {
      if (generationInFlight.current === selection) {
        generationInFlight.current = null;
        enrichment.reset();
      }
    }
  }

  async function onAccept(acceptance: SpeciesEnrichmentAcceptance) {
    if (held?.status !== "ready") return;
    const { generation } = held;
    if (saveBlocked || saveInFlight.current === generation ||
      !isCurrentSelection(held, generation)) return;

    const { userId, accessEpoch, external_species_id, scientific_name, signedProposal } = held;
    const selection = { userId, accessEpoch, external_species_id, scientific_name };
    saveInFlight.current = generation;
    try {
      await save.mutateAsync({ selection, generation, request: {
        signed_proposal: signedProposal,
        accepted_entry: acceptance.accepted_entry,
        management_completions: acceptance.management_completions,
      } });
      if (!isCurrentSelection(selection, generation)) return;
      discardTransient();
      setNotice({ kind: "success", userId, accessEpoch, message: "Species saved." });
    } catch (error) {
      if (!isCurrentSelection(selection, generation)) return;
      const accessDenied = isAppFailure(error) &&
        (error.code === "unauthenticated" || error.code === "unauthorized");
      if (accessDenied || error instanceof AuthenticatedQueryIdentityError) {
        discardTransient();
        setNotice({
          kind: "error", userId, accessEpoch,
          message: accessDenied ? toUserMessage(error) : "Unable to verify Management access. Please search again.",
        });
        if (accessDenied) void requestAuthQuerySync();
      }
    } finally {
      if (saveInFlight.current === generation) saveInFlight.current = null;
    }
  }

  function onSearchAgain() {
    if (saveInFlight.current === proposalGeneration.current) return;
    discardTransient();
  }

  function onNameChange(next: string) {
    nameRef.current = next;
    setName(next);
    if (next === name) return;
    discardTransient();
  }

  if (!offered) return null;

  const searchAgainButton = (
    <Win95Button
      type="button"
      className="shrink-0"
      onClick={onSearchAgain}
      disabled={lookup.isPending || save.isPending}
    >
      {SPECIES_PROPOSAL_COPY.searchAgain}
    </Win95Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {currentEnrichment ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {currentEnrichment.status === "ready" ? (
            <SpeciesProposalAcceptance
              proposal={currentEnrichment.proposal}
              actions={searchAgainButton}
              pending={save.isPending}
              blocked={saveBlocked}
              error={saveFailure?.message ?? null}
              onAccept={onAccept}
            />
          ) : (
            <>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{SPECIES_PROPOSAL_COPY.selected}</p>
                  <p>
                    <span className="font-bold">{SPECIES_PROPOSAL_COPY.scientificName} </span>
                    <span className="whitespace-pre-wrap break-words">{shown?.scientific_name}</span>
                  </p>
                  <p>
                    <span className="font-bold">{SPECIES_PROPOSAL_COPY.externalId} </span>
                    <span className="break-all">{shown?.external_species_id}</span>
                  </p>
                </div>
                {searchAgainButton}
              </div>
              {currentEnrichment.status === "pending" ? (
                <p role="status">Generating species proposal…</p>
              ) : (
                <div className="shrink-0">
                  <p role="alert">Unable to generate the species proposal. Please try again.</p>
                  <Win95Button type="button" onClick={onConfirm}>Retry generation</Win95Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto"
          onSubmit={onSearch}
        >
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
            {lookupCurrent ? searchAgainButton : null}
          </div>

          {lookup.isPending ? (
            <p role="status">{SPECIES_PROPOSAL_COPY.searching}</p>
          ) : null}
          {errorMessage ? <p role="alert">{errorMessage}</p> : null}
          {visibleNotice ? (
            <p role={visibleNotice.kind === "success" ? "status" : "alert"}>{visibleNotice.message}</p>
          ) : null}
          {enrichment.isPending ? (
            <p role="status">Waiting for the previous generation to finish…</p>
          ) : null}

          {matches.length > 0 ? (
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
                        onChange={() => {
                          proposalGeneration.current += 1;
                          setChosenId(match.external_species_id);
                        }}
                      />
                      <span className="min-w-0">
                        <span className="whitespace-pre-wrap break-words">{match.scientific_name}</span>
                        <span className="block break-all">External ID {match.external_species_id}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <Win95Button
                type="button"
                className="mt-2"
                disabled={chosen === null || enrichment.isPending}
                onClick={onConfirm}
              >
                {SPECIES_PROPOSAL_COPY.confirm}
              </Win95Button>
            </fieldset>
          ) : null}

          {lookupCurrent && matches.length === 0 && !lookup.isPending ? (
            <p>{SPECIES_PROPOSAL_COPY.none}</p>
          ) : null}
        </form>
      )}
    </div>
  );
}
