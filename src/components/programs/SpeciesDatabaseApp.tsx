"use client";

import { useState, type ReactNode } from "react";
import { SpeciesProposalPanel } from "@/components/programs/SpeciesProposalPanel";
import {
  canOfferSpeciesProposal,
  sameManagementAccess,
} from "@/components/programs/speciesProposalView";
import {
  useAuthenticatedQuery,
  useVerifiedAuthSnapshot,
} from "@/hooks/useAuthenticatedQuery";
import { toUserMessage } from "@/lib/appResult";
import { requestFreshAuthQuerySync } from "@/lib/authQueryIsolation";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  fetchLocalSpecies,
  filterSpeciesByName,
  resolveSelectedSpeciesId,
  SPECIES_DATABASE_QUERY_KEY,
  type LocalSpecies,
} from "@/components/programs/speciesDatabaseView";

export function SpeciesDatabaseApp() {
  const access = useVerifiedAuthSnapshot();
  const canPropose = canOfferSpeciesProposal(access);
  const [requestedTab, setRequestedTab] = useState<"browse" | "propose">("browse");
  if (!canPropose && requestedTab !== "browse") {
    setRequestedTab("browse");
  }
  const tab = canPropose && requestedTab === "propose" ? "propose" : "browse";

  async function openProposal() {
    const started = getVerifiedAuthSnapshot();
    if (!canOfferSpeciesProposal(started)) return;
    const verified = await requestFreshAuthQuerySync();
    const after = getVerifiedAuthSnapshot();
    if (!verified || !sameManagementAccess(started, verified, after)) return;
    setRequestedTab("propose");
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-sm text-[var(--os-text)]">
      {canPropose ? (
        <div role="tablist" aria-label="Species database" className="mb-2 flex shrink-0 gap-1">
          <TabButton
            selected={tab === "browse"}
            onClick={() => setRequestedTab("browse")}
          >
            Browse Species
          </TabButton>
          <TabButton
            selected={tab === "propose"}
            onClick={() => {
              void openProposal();
            }}
          >
            New Species Proposal
          </TabButton>
        </div>
      ) : null}
      <div className={tab === "browse" ? "contents" : "hidden"}>
        <SpeciesBrowser />
      </div>
      {tab === "propose" ? <SpeciesProposalPanel /> : null}
      <footer className="mt-2 flex shrink-0 items-center justify-between border-t border-[var(--os-border-dark)] pt-1 text-xs">
        <span>CONFIDENTIAL</span>
        <span>© Project Amber</span>
      </footer>
    </div>
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`px-2 py-0.5 text-sm ${
        selected
          ? "os-bevel-in bg-[var(--os-button-face)] text-[var(--os-button-text)]"
          : "os-bevel-button"
      }`}
    >
      {children}
    </button>
  );
}

function SpeciesBrowser() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const speciesQuery = useAuthenticatedQuery({
    queryKey: SPECIES_DATABASE_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchLocalSpecies(getSupabaseBrowserClient(), signal),
  });

  const species = speciesQuery.data;
  const visible = species ? filterSpeciesByName(species, query) : [];
  const resolvedId = species
    ? resolveSelectedSpeciesId(visible, selectedId)
    : null;
  if (species && resolvedId !== selectedId) {
    setSelectedId(resolvedId);
  }

  const selected = visible.find((entry) => entry.id === resolvedId) ?? null;

  let main: ReactNode;
  if (speciesQuery.isPending) {
    main = <p>Loading species records…</p>;
  } else if (speciesQuery.isError) {
    main = <p role="alert">{toUserMessage(speciesQuery.error)}</p>;
  } else if (!species || species.length === 0) {
    main = <p>No species records are stored locally.</p>;
  } else if (!selected) {
    main = <p>No species match this search.</p>;
  } else {
    // A new key remounts both panels so the next species starts unscrolled.
    main = <SpeciesDetail key={selected.id} species={selected} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <label className="mb-2 block shrink-0">
        <span className="mb-1 block">Search</span>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none"
        />
      </label>

      <div className="flex min-h-0 flex-1 gap-2">
        <ul
          aria-label="Local species"
          className="os-bevel-in w-40 shrink-0 overflow-y-auto p-1"
        >
          {visible.map((entry) => {
            const isSelected = entry.id === resolvedId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`block w-full break-words px-1 py-0.5 text-left ${
                    isSelected
                      ? "bg-[var(--os-titlebar)] text-[var(--os-text)]"
                      : ""
                  }`}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => setSelectedId(entry.id)}
                >
                  {entry.display_name}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
      </div>
    </div>
  );
}

function SpeciesDetail({ species }: { species: LocalSpecies }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="break-words text-base font-bold">{species.display_name}</h2>
        <p>
          <span className="font-bold">Safety class </span>
          {species.safety_class}
        </p>
      </div>
      <div className="@container min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col gap-2 @md:flex-row">
          <DetailPanel>
            <SpeciesField
              label="General Description"
              value={species.general_description}
            />
            <SpeciesField
              label="Diet Preferences"
              value={species.diet_preferences}
            />
            <SpeciesField
              label="Habitat Preferences"
              value={species.habitat_preferences}
            />
          </DetailPanel>
          <DetailPanel>
            <SpeciesField
              label="Handling Guidance"
              value={species.handling_guidance}
            />
            <SpeciesField
              label="Minimum Handlers"
              value={String(species.minimum_handlers)}
            />
          </DetailPanel>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ children }: { children: ReactNode }) {
  return (
    <section className="os-bevel-in min-h-0 min-w-0 flex-1 overflow-auto p-2">
      {children}
    </section>
  );
}

function SpeciesField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="font-bold">{label}</div>
      <p className="break-words whitespace-pre-wrap">{value}</p>
    </div>
  );
}
