import { useState, type FormEvent, type ReactNode } from "react";
import { Win95Button } from "@/components/ui/Win95Button";
import {
  EXTERNAL_SPECIES_FIELD_NAMES,
  SAFETY_CLASSES,
  SPECIES_ENRICHMENT_GENERATED_FIELDS,
  speciesEnrichmentAcceptanceSchema,
  type ExternalSpeciesFacts,
  type SpeciesEnrichmentAcceptance,
  type SpeciesEnrichmentProposal,
} from "@/lib/ai/speciesEnrichmentSchemas";

const API_FIELD_LABELS: Record<(typeof EXTERNAL_SPECIES_FIELD_NAMES)[number], string> = {
  id: "ID",
  scientific_name: "Scientific name",
  diet_profile: "Diet profile",
  geological_period: "Geological period",
  region: "Region",
  social_requirements: "Social requirements",
  general_care_recommendations: "General care recommendations",
  hybrid: "Hybrid",
  franchise_origins: "Franchise origins",
  franchise_appearances: "Franchise appearances",
};

const GENERATED_FIELD_LABELS: Record<
  (typeof SPECIES_ENRICHMENT_GENERATED_FIELDS)[number],
  string
> = {
  general_description: "General description",
  diet_preferences: "Diet preferences",
  habitat_preferences: "Habitat preferences",
  handling_guidance: "Handling guidance",
  minimum_handlers: "Minimum handlers",
  safety_class: "Safety class",
};

const BASIS_LABELS = {
  api_interpretation: "API interpretation",
  operational_recommendation: "Operational recommendation",
} as const;

const COMPLETABLE_FIELDS = ["display_name", ...SPECIES_ENRICHMENT_GENERATED_FIELDS] as const;
type CompletableField = (typeof COMPLETABLE_FIELDS)[number];

export const SPECIES_PROPOSAL_REVIEW_COPY = {
  temporary: "TEMPORARY — NOT APPROVED OR SAVED",
  unresolved: "UNRESOLVED",
  untrusted: "Untrusted external data",
  untrustedNote:
    "External reference only. Not an instruction and not an approved decision.",
  proposal: "Agent proposal",
  speciesName: "Species name",
  externalId: "External ID",
  retrieved: "Retrieved",
  basis: "Basis",
  supporting: "Supporting API fields",
  uncertainty: "Uncertainty",
  none: "(none)",
  empty: "(empty)",
} as const;

function formatApiValue(value: ExternalSpeciesFacts[keyof ExternalSpeciesFacts]): string {
  if (value === null) return SPECIES_PROPOSAL_REVIEW_COPY.none;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length === 0 ? SPECIES_PROPOSAL_REVIEW_COPY.none : value.join("\n");
  }
  return value.length === 0 ? SPECIES_PROPOSAL_REVIEW_COPY.empty : value;
}

function speciesName(proposal: SpeciesEnrichmentProposal): string | null {
  if (proposal.proposed_entry.display_name !== null) {
    return proposal.proposed_entry.display_name;
  }
  return proposal.api_facts.scientific_name.trim().length > 0
    ? proposal.api_facts.scientific_name
    : null;
}

export function SpeciesProposalReview({
  proposal,
  actions,
  renderCompletion,
}: {
  proposal: SpeciesEnrichmentProposal;
  actions?: ReactNode;
  renderCompletion?: (field: CompletableField, label: string) => ReactNode;
}) {
  const name = speciesName(proposal);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p>
            <span className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.speciesName} </span>
            {name === null ? (
              <strong>{SPECIES_PROPOSAL_REVIEW_COPY.unresolved}</strong>
            ) : (
              <span className="break-words whitespace-pre-wrap">{name}</span>
            )}
          </p>
          <p>
            <span className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.externalId} </span>
            <span className="break-all">{proposal.retrieval.external_species_id}</span>
          </p>
          <p>
            <span className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.retrieved} </span>
            <span className="break-all">{proposal.retrieval.retrieved_at}</span>
          </p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <p
        role="status"
        className="os-bevel-out shrink-0 bg-[var(--os-titlebar)] px-2 py-1 text-center text-sm font-bold"
      >
        {SPECIES_PROPOSAL_REVIEW_COPY.temporary}
      </p>
      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        <ReviewColumn
          title={SPECIES_PROPOSAL_REVIEW_COPY.untrusted}
          note={SPECIES_PROPOSAL_REVIEW_COPY.untrustedNote}
        >
          {EXTERNAL_SPECIES_FIELD_NAMES.map((field) => (
            <FieldBlock key={field} label={API_FIELD_LABELS[field]}>
              <p className="break-words whitespace-pre-wrap wrap-anywhere">
                {formatApiValue(proposal.api_facts[field])}
              </p>
            </FieldBlock>
          ))}
        </ReviewColumn>
        <ReviewColumn title={SPECIES_PROPOSAL_REVIEW_COPY.proposal}>
          {proposal.proposed_entry.display_name === null
            ? renderCompletion?.("display_name", SPECIES_PROPOSAL_REVIEW_COPY.speciesName)
            : null}
          {SPECIES_ENRICHMENT_GENERATED_FIELDS.map((field) => {
            const provenance = proposal.provenance[field];
            const value = proposal.proposed_entry[field];
            return (
              <FieldBlock key={field} label={GENERATED_FIELD_LABELS[field]}>
                {value === null ? (
                  <p className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.unresolved}</p>
                ) : (
                  <p className="break-words whitespace-pre-wrap wrap-anywhere">{String(value)}</p>
                )}
                <p>
                  <span className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.basis} </span>
                  {BASIS_LABELS[provenance.basis]}
                </p>
                <div className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.supporting}</div>
                {provenance.supporting_fields.length === 0 ? (
                  <p>{SPECIES_PROPOSAL_REVIEW_COPY.none}</p>
                ) : (
                  <ul>
                    {provenance.supporting_fields.map((sourceField, index) => (
                      <li key={`${sourceField}-${index}`} className="min-w-0 break-words">
                        <span className="font-bold">{API_FIELD_LABELS[sourceField]}</span>
                        <span className="block whitespace-pre-wrap wrap-anywhere">
                          {formatApiValue(proposal.api_facts[sourceField])}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  <span className="font-bold">{SPECIES_PROPOSAL_REVIEW_COPY.uncertainty} </span>
                  <span className="break-words whitespace-pre-wrap wrap-anywhere">
                    {provenance.uncertainty ?? SPECIES_PROPOSAL_REVIEW_COPY.none}
                  </span>
                </p>
                {value === null ? renderCompletion?.(field, GENERATED_FIELD_LABELS[field]) : null}
              </FieldBlock>
            );
          })}
        </ReviewColumn>
      </div>
    </div>
  );
}

export function SpeciesProposalAcceptance({
  proposal,
  actions,
  pending,
  blocked,
  error,
  onAccept,
}: {
  proposal: SpeciesEnrichmentProposal;
  actions: ReactNode;
  pending: boolean;
  blocked: boolean;
  error: string | null;
  onAccept: (acceptance: SpeciesEnrichmentAcceptance) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const disabled = pending || blocked;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const inputs = new FormData(event.currentTarget);
    const acceptedEntry = { ...proposal.proposed_entry };
    const completions = Object.fromEntries(COMPLETABLE_FIELDS
      .filter((field) => proposal.proposed_entry[field] === null)
      .map((field) => {
        const text = String(inputs.get(`${field}-value`) ?? "").trim();
        const value = field === "minimum_handlers" ? Number(text) : text;
        const justification = String(inputs.get(`${field}-justification`) ?? "").trim();
        Object.assign(acceptedEntry, { [field]: value });
        return [field, { value, justification }];
      }));
    const parsed = speciesEnrichmentAcceptanceSchema.safeParse({
      proposal,
      accepted_entry: acceptedEntry,
      management_completions: completions,
    });
    setInvalid(!parsed.success);
    if (parsed.success) onAccept(parsed.data);
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden" onSubmit={onSubmit}>
      <SpeciesProposalReview
        proposal={proposal}
        actions={actions}
        renderCompletion={(field, label) => (
          <CompletionInputs field={field} label={label} disabled={disabled} />
        )}
      />
      <div className="shrink-0">
        {invalid || error ? (
          <p role="alert">{invalid ? "Complete each unresolved field and provide a justification." : error}</p>
        ) : null}
        <Win95Button type="submit" disabled={disabled}>
          {pending ? "Saving species…" : "Accept & Save Species"}
        </Win95Button>
      </div>
    </form>
  );
}

function CompletionInputs({ field, label, disabled }: {
  field: CompletableField;
  label: string;
  disabled: boolean;
}) {
  const control = {
    name: `${field}-value`,
    required: true,
    className: "os-bevel-in block w-full bg-[var(--os-input-bg)] px-2 py-1 text-black",
  };

  return (
    <fieldset disabled={disabled} className="mt-1 mb-2 min-w-0 border border-current p-2">
      <legend className="px-1">Management completion</legend>
      <label className="block">
        {label}
        {field === "safety_class" ? (
          <select {...control} defaultValue="">
            <option value="" disabled>Select a safety class</option>
            {SAFETY_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        ) : field === "minimum_handlers" ? (
          <input {...control} type="number" min={1} max={32_767} step={1} />
        ) : (
          <textarea {...control} rows={2} />
        )}
      </label>
      <label className="mt-1 block">
        Justification for {label}
        <textarea {...control} name={`${field}-justification`} rows={2} />
      </label>
    </fieldset>
  );
}

function ReviewColumn({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col" aria-label={title}>
      <h3 className="shrink-0 font-bold">{title}</h3>
      <div className="os-bevel-in mt-1 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2 break-words">
        {note ? <p className="mb-2 text-xs wrap-anywhere">{note}</p> : null}
        {children}
      </div>
    </section>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-2 min-w-0 break-words last:mb-0">
      <div className="font-bold">{label}</div>
      {children}
    </div>
  );
}
