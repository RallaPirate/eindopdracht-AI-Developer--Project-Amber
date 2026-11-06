import type { ReactNode } from "react";
import {
  EXTERNAL_SPECIES_FIELD_NAMES,
  SPECIES_ENRICHMENT_GENERATED_FIELDS,
  type ExternalSpeciesFacts,
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
}: {
  proposal: SpeciesEnrichmentProposal;
  actions?: ReactNode;
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
              </FieldBlock>
            );
          })}
        </ReviewColumn>
      </div>
    </div>
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
