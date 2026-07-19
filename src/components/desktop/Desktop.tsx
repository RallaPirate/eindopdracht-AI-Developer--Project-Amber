"use client";

import { DesktopIcon } from "@/components/desktop/DesktopIcon";
import { Window } from "@/components/desktop/Window";
import type { WindowState } from "@/components/desktop/useWindowManager";
import { ProgramContent } from "@/components/programs/ProgramContent";
import { PROGRAMS, type ProgramId } from "@/types/programs";
import { getProgram } from "@/types/programs";

type DesktopProps = {
  windows: WindowState[];
  activeId: ProgramId | null;
  onOpenProgram: (id: ProgramId) => void;
  onFocusWindow: (id: ProgramId) => void;
  onCloseWindow: (id: ProgramId) => void;
  onMoveWindow: (id: ProgramId, x: number, y: number) => void;
};

/** First column: 4 icons; second column: 1 icon (Personnel). */
const ICON_LAYOUT: { id: ProgramId; column: number; row: number }[] = [
  { id: "reports", column: 0, row: 0 },
  { id: "archive", column: 0, row: 1 },
  { id: "species-database", column: 0, row: 2 },
  { id: "assistant", column: 0, row: 3 },
  { id: "personnel", column: 1, row: 0 },
];

export function Desktop({
  windows,
  activeId,
  onOpenProgram,
  onFocusWindow,
  onCloseWindow,
  onMoveWindow,
}: DesktopProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/background-desktop.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      <div className="absolute inset-0 p-2">
        {ICON_LAYOUT.map(({ id, column, row }) => {
          const program = PROGRAMS.find((p) => p.id === id)!;
          return (
            <div
              key={id}
              className="absolute"
              style={{
                left: 8 + column * 88,
                top: 8 + row * 88,
              }}
            >
              <DesktopIcon
                label={program.title}
                iconSrc={program.iconSrc}
                iconAlt={program.iconAlt}
                onOpen={() => onOpenProgram(id)}
              />
            </div>
          );
        })}
      </div>

      {windows.map((win) => {
        const program = getProgram(win.id);
        return (
          <Window
            key={win.id}
            title={program.title}
            active={activeId === win.id}
            x={win.x}
            y={win.y}
            zIndex={win.zIndex}
            onFocus={() => onFocusWindow(win.id)}
            onClose={() => onCloseWindow(win.id)}
            onMove={(x, y) => onMoveWindow(win.id, x, y)}
          >
            <ProgramContent id={win.id} />
          </Window>
        );
      })}
    </div>
  );
}
