"use client";

import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

type WindowProps = {
  title: string;
  active: boolean;
  x: number;
  y: number;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMove: (x: number, y: number) => void;
  children?: ReactNode;
  width?: number;
  height?: number;
};

export function Window({
  title,
  active,
  x,
  y,
  zIndex,
  onFocus,
  onClose,
  onMove,
  children,
  width = 420,
  height = 300,
}: WindowProps) {
  const dragOffset = useRef({ x: 0, y: 0 });

  function startDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    onFocus();

    dragOffset.current = {
      x: event.clientX - x,
      y: event.clientY - y,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      onMove(
        moveEvent.clientX - dragOffset.current.x,
        moveEvent.clientY - dragOffset.current.y,
      );
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const titlebarBg = active
    ? "bg-[var(--os-titlebar)]"
    : "bg-[var(--os-titlebar-inactive)]";

  return (
    <div
      className="os-bevel-out absolute flex flex-col bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]"
      style={{ left: x, top: y, zIndex, width, height }}
      onMouseDown={onFocus}
    >
      <div
        className={`flex cursor-default items-center justify-between px-2 py-1 select-none ${titlebarBg}`}
        onMouseDown={startDrag}
      >
        <span className="truncate text-sm font-bold text-[var(--os-text)]">
          {title}
        </span>
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="os-bevel-button flex h-4 w-4 shrink-0 items-center justify-center p-0 text-[10px] leading-none"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>
      <div className="os-bevel-in mt-1 min-h-0 flex-1 overflow-auto bg-[var(--os-graphite)] p-2 text-[var(--os-text)]">
        {children}
      </div>
    </div>
  );
}
