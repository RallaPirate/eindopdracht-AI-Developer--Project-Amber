"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  SpeciesEditorForm,
  type SpeciesEditReloadResult,
} from "@/components/programs/SpeciesEditorForm";
import { SpeciesProposalPanel } from "@/components/programs/SpeciesProposalPanel";
import { canEditLocalSpecies } from "@/components/programs/speciesDatabaseUpdate";
import {
  canOfferSpeciesProposal,
  sameManagementAccess,
} from "@/components/programs/speciesProposalView";
import { Win95Button } from "@/components/ui/Win95Button";
import {
  useAuthenticatedQuery,
  useVerifiedAuthSnapshot,
} from "@/hooks/useAuthenticatedQuery";
import { toUserMessage } from "@/lib/appResult";
import { requestFreshAuthQuerySync } from "@/lib/authQueryIsolation";
import type { AuthAccessSnapshot } from "@/lib/queryCacheIsolation";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  fetchLocalSpecies,
  filterSpeciesByName,
  resolveSelectedSpeciesId,
  sortLocalSpecies,
  SPECIES_DATABASE_QUERY_KEY,
  type LocalSpecies,
} from "@/components/programs/speciesDatabaseView";

type SpeciesEditSession = {
  userId: string;
  accessEpoch: number;
  baseline: LocalSpecies;
};

function sessionIsCurrent(
  session: SpeciesEditSession,
  access: AuthAccessSnapshot,
): boolean {
  return (
    canEditLocalSpecies(access) &&
    access.userId === session.userId &&
    access.accessEpoch === session.accessEpoch
  );
}

function TabButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
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

type Navigation =
  | { kind: "species"; id: string }
  | { kind: "search"; query: string }
  | { kind: "propose" };

export function SpeciesDatabaseApp() {
  const access = useVerifiedAuthSnapshot();
  const canEdit = canEditLocalSpecies(access);
  const canPropose = canOfferSpeciesProposal(access);
  const [requestedTab, setRequestedTab] = useState<"browse" | "propose">("browse");
  if (!canPropose && requestedTab !== "browse") setRequestedTab("browse");
  const tab = canPropose && requestedTab === "propose" ? "propose" : "browse";
  const [searchText, setSearchText] = useState("");
  const [confirmation, setConfirmation] = useState<Navigation | null>(null);
  const dirty = useRef(false);
  const busyLock = useRef(false);
  const navigationVersion = useRef(0);
  useEffect(() => () => {
    navigationVersion.current += 1;
  }, []);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editSession, setEditSession] = useState<SpeciesEditSession | null>(null);
  const [formGeneration, setFormGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const speciesQuery = useAuthenticatedQuery({
    queryKey: SPECIES_DATABASE_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchLocalSpecies(getSupabaseBrowserClient(), signal),
  });

  const species = speciesQuery.data;
  const sessionCurrent = editSession !== null && sessionIsCurrent(editSession, access);
  const editing = sessionCurrent ? editSession : null;
  const filtered = species ? filterSpeciesByName(species, query) : [];
  // A refreshed name can leave the filter, but it cannot navigate away from
  // an open editor. Keep its UUID visible until explicit navigation or save.
  const editedRow = editing
    ? species?.find((entry) => entry.id === editing.baseline.id) ?? editing.baseline
    : null;
  const visible = editedRow && !filtered.some((entry) => entry.id === editedRow.id)
    ? sortLocalSpecies([...filtered, editedRow])
    : filtered;
  const resolvedId = editing ? editing.baseline.id : species
    ? resolveSelectedSpeciesId(visible, selectedId)
    : null;
  if (species && resolvedId !== selectedId) {
    setSelectedId(resolvedId);
  }

  const selected = visible.find((entry) => entry.id === resolvedId) ?? null;
  if (editSession && !sessionCurrent) {
    setEditSession(null);
    setConfirmation(null);
  }

  const onBusyChange = useCallback((next: boolean) => {
    busyLock.current = next;
    setBusy(next);
    if (next) navigationVersion.current += 1;
  }, []);

  function onDirtyChange(next: boolean) {
    dirty.current = next;
    navigationVersion.current += 1;
  }

  async function navigate(target: Navigation) {
    const version = ++navigationVersion.current;
    if (target.kind === "species") setSelectedId(target.id);
    if (target.kind === "search") setQuery(target.query);
    if (target.kind !== "propose") return;
    const started = getVerifiedAuthSnapshot();
    if (!canOfferSpeciesProposal(started)) return;
    const verified = await requestFreshAuthQuerySync();
    const after = getVerifiedAuthSnapshot();
    if (version !== navigationVersion.current || busyLock.current ||
        !verified || !sameManagementAccess(started, verified, after)) return;
    setRequestedTab("propose");
  }

  function requestNavigation(target: Navigation) {
    if (busyLock.current || confirmation) return;
    if (editSession && !sessionIsCurrent(editSession, getVerifiedAuthSnapshot())) {
      closeEdit();
      return;
    }
    if (editing && dirty.current) {
      navigationVersion.current += 1;
      setConfirmation(target);
      return;
    }
    closeEdit();
    void navigate(target);
  }

  function openEdit(species: LocalSpecies) {
    const current = getVerifiedAuthSnapshot();
    if (!canEditLocalSpecies(current) || current.userId === null) return;
    if (access.userId !== current.userId || access.accessEpoch !== current.accessEpoch) {
      return;
    }
    navigationVersion.current += 1;
    dirty.current = false;
    setEditSession({
      userId: current.userId,
      accessEpoch: current.accessEpoch,
      baseline: species,
    });
  }

  function closeEdit() {
    navigationVersion.current += 1;
    dirty.current = false;
    setConfirmation(null);
    setEditSession(null);
  }

  function finishSave(saved: LocalSpecies) {
    setSelectedId(saved.id);
    if (filterSpeciesByName([saved], query).length === 0) {
      setQuery("");
      setSearchText("");
    }
    closeEdit();
  }

  async function reloadEditedSpecies(): Promise<SpeciesEditReloadResult> {
    const session = editSession;
    const started = getVerifiedAuthSnapshot();
    if (!session || !sessionIsCurrent(session, started)) return { status: "stale" };
    const outcome = await speciesQuery.refetch();
    const after = getVerifiedAuthSnapshot();
    if (!sessionIsCurrent(session, after)) return { status: "stale" };
    if (outcome.isError || !outcome.data) {
      return { status: "failed", error: outcome.error };
    }
    const row = outcome.data.find((entry) => entry.id === session.baseline.id);
    if (!row) {
      setEditSession((current) =>
        current?.baseline.id === session.baseline.id &&
        current.userId === session.userId &&
        current.accessEpoch === session.accessEpoch
          ? null
          : current,
      );
      return { status: "missing" };
    }
    setEditSession((current) => {
      if (
        !current ||
        current.baseline.id !== session.baseline.id ||
        current.userId !== session.userId ||
        current.accessEpoch !== session.accessEpoch
      ) {
        return current;
      }
      return { ...current, baseline: row };
    });
    dirty.current = false;
    setFormGeneration((current) => current + 1);
    return { status: "reloaded" };
  }

  let main: ReactNode;
  if (speciesQuery.isPending && !editing) {
    main = <p>Loading species records…</p>;
  } else if (speciesQuery.isError && !species && !editing) {
    main = <p role="alert">{toUserMessage(speciesQuery.error)}</p>;
  } else if ((!species || species.length === 0) && !editing) {
    main = <p>No species records are stored locally.</p>;
  } else if (!selected) {
    main = <p>No species match this search.</p>;
  } else {
    // A new key remounts both panels so the next species starts unscrolled.
    main = (
      <SpeciesDetail
        key={selected.id}
        species={selected}
        canEdit={canEdit}
        editing={editing}
        formGeneration={formGeneration}
        onEdit={() => openEdit(selected)}
        onCancel={closeEdit}
        onSaved={finishSave}
        onAccessLost={closeEdit}
        onReload={reloadEditedSpecies}
        onBusyChange={onBusyChange}
        onDirtyChange={onDirtyChange}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-sm text-[var(--os-text)]">
      {canPropose ? (
        <div role="tablist" aria-label="Species database" className="mb-2 flex shrink-0 gap-1">
          <TabButton selected={tab === "browse"} disabled={busy || !!confirmation}
            onClick={() => { navigationVersion.current += 1; setRequestedTab("browse"); }}>
            Browse Species
          </TabButton>
          <TabButton selected={tab === "propose"} disabled={busy || !!confirmation}
            onClick={() => { if (tab !== "propose") requestNavigation({ kind: "propose" }); }}>
            New Species Proposal
          </TabButton>
        </div>
      ) : null}
      {confirmation && editing ? (
        <section role="alertdialog" aria-modal="true" aria-labelledby="discard-species-title"
          aria-describedby="discard-species-description" className="os-bevel-out mb-2 p-3">
          <h2 id="discard-species-title" className="font-bold">Unsaved species changes</h2>
          <p id="discard-species-description">Discard your changes before navigating?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Win95Button type="button" autoFocus onClick={() => setConfirmation(null)}>
              Stay and continue editing
            </Win95Button>
            <Win95Button type="button" onClick={() => {
              if (busyLock.current || !editSession ||
                  !sessionIsCurrent(editSession, getVerifiedAuthSnapshot())) return;
              const target = confirmation;
              closeEdit();
              void navigate(target);
            }}>Discard changes and navigate</Win95Button>
          </div>
        </section>
      ) : null}
      <div className={tab === "browse" ? "contents" : "hidden"}>
        <fieldset disabled={!!confirmation} className="m-0 flex min-h-0 flex-1 flex-col border-0 p-0">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (searchText !== query) requestNavigation({ kind: "search", query: searchText });
          }} className="mb-2 flex shrink-0 items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block">Search</span>
              <input
                type="text"
                value={searchText}
                disabled={busy}
                onChange={(event) => {
                  if (busyLock.current || confirmation) return;
                  const next = event.target.value;
                  setSearchText(next);
                  navigationVersion.current += 1;
                  // Hiding filters wait for Search/Enter, keeping typing uninterrupted.
                  const keepsEditor = editing &&
                    filterSpeciesByName([editedRow ?? editing.baseline], next).length > 0;
                  if (!editing || !dirty.current || keepsEditor) {
                    if (editing && !keepsEditor) closeEdit();
                    setQuery(next);
                  }
                }}
                className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:text-[var(--os-disabled)]"
              />
            </label>
            <Win95Button type="submit" disabled={busy || searchText === query}>Search</Win95Button>
          </form>

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
                      disabled={busy}
                      className={`block w-full break-words px-1 py-0.5 text-left disabled:text-[var(--os-disabled)] ${
                        isSelected
                          ? "bg-[var(--os-titlebar)] text-[var(--os-text)]"
                          : ""
                      }`}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        if (entry.id !== resolvedId) requestNavigation({ kind: "species", id: entry.id });
                      }}
                    >
                      {entry.display_name}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {speciesQuery.isError && (species || editing) ? (
                <p role="alert" className="mb-2 shrink-0">{toUserMessage(speciesQuery.error)}</p>
              ) : null}
              {main}
            </div>
          </div>
        </fieldset>
      </div>
      {tab === "propose" ? <SpeciesProposalPanel /> : null}
      <footer className="mt-2 flex shrink-0 items-center justify-between border-t border-[var(--os-border-dark)] pt-1 text-xs">
        <span>CONFIDENTIAL</span><span>© Project Amber</span>
      </footer>
    </div>
  );
}

function SpeciesDetail({
  species,
  canEdit,
  editing,
  formGeneration,
  onEdit,
  onCancel,
  onSaved,
  onAccessLost,
  onReload,
  onBusyChange,
  onDirtyChange,
}: {
  species: LocalSpecies;
  canEdit: boolean;
  editing: SpeciesEditSession | null;
  formGeneration: number;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (species: LocalSpecies) => void;
  onAccessLost: () => void;
  onReload: () => Promise<SpeciesEditReloadResult>;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (editing) {
    return (
      <SpeciesEditorForm
        key={`${editing.userId}:${editing.accessEpoch}:${editing.baseline.id}:${formGeneration}`}
        baseline={editing.baseline}
        owner={{ userId: editing.userId, accessEpoch: editing.accessEpoch }}
        onCancel={onCancel}
        onSaved={onSaved}
        onAccessLost={onAccessLost}
        onReload={onReload}
        onBusyChange={onBusyChange}
        onDirtyChange={onDirtyChange}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="break-words text-base font-bold">{species.display_name}</h2>
          <p>
            <span className="font-bold">Safety class </span>
            {species.safety_class}
          </p>
        </div>
        {canEdit ? (
          <Win95Button type="button" className="shrink-0" onClick={onEdit}>
            Edit Species
          </Win95Button>
        ) : null}
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
