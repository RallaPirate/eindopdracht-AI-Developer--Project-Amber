export type ProgramId =
  | "reports"
  | "archive"
  | "species-database"
  | "assistant"
  | "personnel";

export type ProgramDefinition = {
  id: ProgramId;
  title: string;
  iconSrc: string;
  iconAlt: string;
};

export const PROGRAMS: ProgramDefinition[] = [
  {
    id: "reports",
    title: "Reports.exe",
    iconSrc: "/icons/reports.png",
    iconAlt: "Reports",
  },
  {
    id: "archive",
    title: "Archive.exe",
    iconSrc: "/icons/archive.png",
    iconAlt: "Archive",
  },
  {
    id: "species-database",
    title: "Species_Database.exe",
    iconSrc: "/icons/species-database.png",
    iconAlt: "Species Database",
  },
  {
    id: "assistant",
    title: "Assistant.exe",
    iconSrc: "/icons/assistant.png",
    iconAlt: "Assistant",
  },
  {
    id: "personnel",
    title: "Personnel.exe",
    iconSrc: "/icons/personnel.png",
    iconAlt: "Personnel",
  },
];

export function getProgram(id: ProgramId): ProgramDefinition {
  const program = PROGRAMS.find((p) => p.id === id);
  if (!program) {
    throw new Error(`Unknown program: ${id}`);
  }
  return program;
}
