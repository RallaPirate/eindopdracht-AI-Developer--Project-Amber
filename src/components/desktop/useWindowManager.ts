"use client";

import { useCallback, useState } from "react";
import type { ProgramId } from "@/types/programs";

export type WindowState = {
  id: ProgramId;
  x: number;
  y: number;
  zIndex: number;
};

const DEFAULT_OFFSET = 28;
const DEFAULT_ORIGIN = { x: 80, y: 48 };
const SPECIES_WINDOW_ORIGIN = { x: 16, y: 16 };

function initialPosition(id: ProgramId, openCount: number) {
  if (id === "species-database") return SPECIES_WINDOW_ORIGIN;
  return {
    x: DEFAULT_ORIGIN.x + openCount * DEFAULT_OFFSET,
    y: DEFAULT_ORIGIN.y + openCount * DEFAULT_OFFSET,
  };
}

function raiseWindow(windows: WindowState[], id: ProgramId): WindowState[] {
  const maxZ = windows.reduce((max, win) => Math.max(max, win.zIndex), 0);
  return windows.map((win) =>
    win.id === id ? { ...win, zIndex: maxZ + 1 } : win,
  );
}

export function useWindowManager() {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeId, setActiveId] = useState<ProgramId | null>(null);

  const focusWindow = useCallback((id: ProgramId) => {
    setWindows((current) => raiseWindow(current, id));
    setActiveId(id);
  }, []);

  const openWindow = useCallback((id: ProgramId) => {
    setWindows((current) => {
      if (current.some((win) => win.id === id)) {
        return raiseWindow(current, id);
      }

      const openCount = current.length;
      const maxZ = current.reduce((max, win) => Math.max(max, win.zIndex), 9);
      return [
        ...current,
        {
          id,
          ...initialPosition(id, openCount),
          zIndex: maxZ + 1,
        },
      ];
    });
    setActiveId(id);
  }, []);

  const closeWindow = useCallback((id: ProgramId) => {
    setWindows((current) => {
      const remaining = current.filter((win) => win.id !== id);
      setActiveId((prev) => {
        if (prev !== id) return prev;
        if (remaining.length === 0) return null;
        return remaining.reduce((top, win) =>
          win.zIndex > top.zIndex ? win : top,
        ).id;
      });
      return remaining;
    });
  }, []);

  const moveWindow = useCallback((id: ProgramId, x: number, y: number) => {
    setWindows((current) =>
      current.map((win) => (win.id === id ? { ...win, x, y } : win)),
    );
  }, []);

  const resetWindows = useCallback(() => {
    setWindows([]);
    setActiveId(null);
  }, []);

  return {
    windows,
    activeId,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resetWindows,
  };
}
