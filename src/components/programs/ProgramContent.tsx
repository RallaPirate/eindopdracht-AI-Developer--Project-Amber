"use client";

import type { ProgramId } from "@/types/programs";
import { AssistantApp } from "@/components/programs/AssistantApp";
import { ArchiveApp } from "@/components/programs/ArchiveApp";
import { PersonnelApp } from "@/components/programs/PersonnelApp";
import { ReportsApp } from "@/components/programs/ReportsApp";
import { SpeciesDatabaseApp } from "@/components/programs/SpeciesDatabaseApp";

export function ProgramContent({ id }: { id: ProgramId }) {
  switch (id) {
    case "reports":
      return <ReportsApp />;
    case "archive":
      return <ArchiveApp />;
    case "species-database":
      return <SpeciesDatabaseApp />;
    case "assistant":
      return <AssistantApp />;
    case "personnel":
      return <PersonnelApp />;
  }
}
