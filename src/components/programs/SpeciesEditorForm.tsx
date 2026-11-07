"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useUpdateLocalSpecies } from "@/components/programs/useUpdateLocalSpecies";
import { canEditLocalSpecies } from "@/components/programs/speciesDatabaseUpdate";
import {
  canSaveSpeciesEdit,
  parseSpeciesEditDraft,
  speciesEditDraftFrom,
  speciesEditHasChanges,
  type SpeciesEditDraft,
} from "@/components/programs/speciesEditorDraft";
import { Win95Button } from "@/components/ui/Win95Button";
import { isAppFailure, toUserMessage } from "@/lib/appResult";
import { requestAuthQuerySync } from "@/lib/authQueryIsolation";
import { AuthenticatedQueryIdentityError } from "@/lib/queryCacheIsolation";
import { getVerifiedAuthSnapshot } from "@/lib/queryClient";
import { SAFETY_CLASSES, type LocalSpecies } from "@/components/programs/speciesDatabaseView";

export const SPECIES_EDITOR_COPY = {
  title: "Edit Species",
  displayName: "Display name",
  generalDescription: "General Description",
  dietPreferences: "Diet Preferences",
  habitatPreferences: "Habitat Preferences",
  handlingGuidance: "Handling Guidance",
  minimumHandlers: "Minimum Handlers",
  safetyClass: "Safety class",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  discard: "Discard & Reload",
  conflict:
    "This species record may have changed since you opened it. Your draft has been kept. Discard & Reload to load the current record.",
} as const;

const FIELD_LABELS = {
  display_name: SPECIES_EDITOR_COPY.displayName,
  general_description: SPECIES_EDITOR_COPY.generalDescription,
  diet_preferences: SPECIES_EDITOR_COPY.dietPreferences,
  habitat_preferences: SPECIES_EDITOR_COPY.habitatPreferences,
  handling_guidance: SPECIES_EDITOR_COPY.handlingGuidance,
  minimum_handlers: SPECIES_EDITOR_COPY.minimumHandlers,
  safety_class: SPECIES_EDITOR_COPY.safetyClass,
} as const;

const CONTROL_CLASS =
  "os-bevel-in mt-1 block w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none";

export type SpeciesEditOwner = {
  userId: string;
  accessEpoch: number;
};

export type SpeciesEditReloadResult =
  | { status: "reloaded" }
  | { status: "missing" }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

function sameOwner(owner: SpeciesEditOwner): boolean {
  const access = getVerifiedAuthSnapshot();
  return (
    canEditLocalSpecies(access) &&
    access.userId === owner.userId &&
    access.accessEpoch === owner.accessEpoch
  );
}

export function SpeciesEditorForm({
  baseline,
  owner,
  onCancel,
  onSaved,
  onAccessLost,
  onReload,
  onBusyChange,
  onDirtyChange,
}: {
  baseline: LocalSpecies;
  owner: SpeciesEditOwner;
  onCancel: () => void;
  onSaved: (species: LocalSpecies) => void;
  onAccessLost: () => void;
  onReload: () => Promise<SpeciesEditReloadResult>;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const update = useUpdateLocalSpecies();
  const [draft, setDraft] = useState(() => speciesEditDraftFrom(baseline));
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<"save" | "reload" | null>(null);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const canSave = canSaveSpeciesEdit(baseline, draft);
  const busy = pending !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);

  function setPendingWork(next: "save" | "reload" | null) {
    setPending(next);
    onBusyChange(next !== null);
  }

  function updateDraft<Key extends keyof SpeciesEditDraft>(
    key: Key,
    value: SpeciesEditDraft[Key],
  ) {
    const next = { ...draft, [key]: value };
    const original = speciesEditDraftFrom(baseline);
    onDirtyChange((Object.keys(original) as (keyof SpeciesEditDraft)[])
      .some((field) => next[field] !== original[field]));
    setDraft(next);
  }

  function keepDraft(error: unknown): boolean {
    if (!mounted.current) return true;
    const denied = isAppFailure(error) &&
      (error.code === "unauthenticated" || error.code === "unauthorized");
    if (error instanceof AuthenticatedQueryIdentityError || !sameOwner(owner)) {
      onAccessLost();
      if (denied) void requestAuthQuerySync();
      return true;
    }
    if (denied) void requestAuthQuerySync();
    const concurrencyConflict = isAppFailure(error) && error.code === "conflict";
    setConflict(concurrencyConflict);
    setMessage(concurrencyConflict ? SPECIES_EDITOR_COPY.conflict : toUserMessage(error));
    return false;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || busy) return;
    const parsed = parseSpeciesEditDraft(draft);
    if (!parsed.ok || !speciesEditHasChanges(baseline, parsed.data)) return;
    if (!sameOwner(owner)) {
      onAccessLost();
      return;
    }

    submitLock.current = true;
    setConflict(false);
    setMessage(null);
    setPendingWork("save");
    let closed = false;
    try {
      const saved = await update.mutateAsync({
        id: baseline.id,
        updated_at: baseline.updated_at,
        fields: parsed.data,
      });
      if (!mounted.current) return;
      if (!sameOwner(owner)) {
        closed = true;
        onAccessLost();
        return;
      }
      closed = true;
      onSaved(saved);
    } catch (error) {
      closed = keepDraft(error);
    } finally {
      submitLock.current = false;
      if (mounted.current && !closed) setPendingWork(null);
    }
  }

  async function onDiscard(event: FormEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (submitLock.current || busy) return;
    if (!sameOwner(owner)) {
      onAccessLost();
      return;
    }
    submitLock.current = true;
    setPendingWork("reload");
    let closed = false;
    try {
      const result = await onReload();
      if (!mounted.current) return;
      if (result.status === "stale" || !sameOwner(owner)) {
        closed = true;
        onAccessLost();
        return;
      }
      if (result.status === "missing") {
        closed = true;
        onCancel();
        return;
      }
      if (result.status === "reloaded") {
        closed = true;
        return;
      }
      setConflict(true);
      setMessage(toUserMessage(result.error));
    } finally {
      submitLock.current = false;
      if (mounted.current && !closed) setPendingWork(null);
    }
  }

  return (
    <form
      aria-label={SPECIES_EDITOR_COPY.title}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={onSubmit}
    >
      <h2 className="mb-2 shrink-0 text-base font-bold">{SPECIES_EDITOR_COPY.title}</h2>
      <fieldset
        disabled={busy}
        className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
      >
        <div className="mb-2 flex shrink-0 flex-wrap gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
          <EditorLabel label={FIELD_LABELS.display_name}>
            <input
              name="display_name"
              value={draft.display_name}
              disabled={busy}
              onChange={(event) => updateDraft("display_name", event.target.value)}
              className={CONTROL_CLASS}
            />
          </EditorLabel>
          </div>
          <div className="min-w-0 flex-1 basis-40">
          <EditorLabel label={FIELD_LABELS.safety_class}>
            <select
              name="safety_class"
              value={draft.safety_class}
              disabled={busy}
              onChange={(event) => {
                const next = SAFETY_CLASSES.find((value) => value === event.target.value);
                if (next) updateDraft("safety_class", next);
              }}
              className={CONTROL_CLASS}
            >
              {SAFETY_CLASSES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </EditorLabel>
          </div>
        </div>
        <div className="@container min-h-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-2 @md:flex-row">
            <EditorColumn>
              <EditorText
                name="general_description"
                label={FIELD_LABELS.general_description}
                value={draft.general_description}
                disabled={busy}
                onChange={(value) => updateDraft("general_description", value)}
              />
              <EditorText
                name="diet_preferences"
                label={FIELD_LABELS.diet_preferences}
                value={draft.diet_preferences}
                disabled={busy}
                onChange={(value) => updateDraft("diet_preferences", value)}
              />
              <EditorText
                name="habitat_preferences"
                label={FIELD_LABELS.habitat_preferences}
                value={draft.habitat_preferences}
                disabled={busy}
                onChange={(value) => updateDraft("habitat_preferences", value)}
              />
            </EditorColumn>
            <EditorColumn>
              <EditorText
                name="handling_guidance"
                label={FIELD_LABELS.handling_guidance}
                value={draft.handling_guidance}
                disabled={busy}
                onChange={(value) => updateDraft("handling_guidance", value)}
              />
              <EditorLabel label={FIELD_LABELS.minimum_handlers}>
                <input
                  name="minimum_handlers"
                  type="number"
                  min={1}
                  max={32_767}
                  step={1}
                  disabled={busy}
                  value={draft.minimum_handlers}
                  onChange={(event) => updateDraft("minimum_handlers", event.target.value)}
                  className={CONTROL_CLASS}
                />
              </EditorLabel>
            </EditorColumn>
          </div>
        </div>
      </fieldset>
      {message ? <p role="alert" className="mt-2 shrink-0">{message}</p> : null}
      <div className="mt-2 flex shrink-0 flex-wrap gap-2">
        <Win95Button type="submit" disabled={busy || !canSave}>
          {pending === "save" ? SPECIES_EDITOR_COPY.saving : SPECIES_EDITOR_COPY.save}
        </Win95Button>
        <Win95Button type="button" onClick={() => {
          if (!submitLock.current && !busy) onCancel();
        }} disabled={busy}>
          {SPECIES_EDITOR_COPY.cancel}
        </Win95Button>
        {conflict ? (
          <Win95Button type="button" onClick={onDiscard} disabled={busy}>
            {SPECIES_EDITOR_COPY.discard}
          </Win95Button>
        ) : null}
      </div>
    </form>
  );
}

function EditorColumn({ children }: { children: ReactNode }) {
  return (
    <section className="os-bevel-in min-h-0 min-w-0 flex-1 overflow-auto p-2">
      {children}
    </section>
  );
}

function EditorLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-2 block min-w-0 last:mb-0">
      <span className="font-bold">{label}</span>
      {children}
    </label>
  );
}

function EditorText({
  name,
  label,
  value,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <EditorLabel label={label}>
      <textarea
        name={name}
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_CLASS}
      />
    </EditorLabel>
  );
}
