import { SpeciesSpecimenSelector } from "@/components/programs/SpeciesSpecimenSelector";

export function ReportsApp() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p>Choose the species this report covers. Linking a specimen is optional.</p>
      <SpeciesSpecimenSelector />
    </div>
  );
}
