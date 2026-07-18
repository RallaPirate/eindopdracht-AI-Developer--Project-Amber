"use client";

type DesktopIconProps = {
  label: string;
  iconSrc: string;
  iconAlt: string;
  onOpen: () => void;
};

export function DesktopIcon({
  label,
  iconSrc,
  iconAlt,
  onOpen,
}: DesktopIconProps) {
  return (
    <button
      type="button"
      onDoubleClick={onOpen}
      onClick={onOpen}
      className="flex w-[76px] flex-col items-center gap-1 border border-transparent bg-transparent p-1 text-center text-[var(--os-text)] outline-none hover:border-[var(--os-text)]/30 focus-visible:border-[var(--os-text)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={iconSrc}
        alt={iconAlt}
        width={32}
        height={32}
        className="h-8 w-8 object-contain drop-shadow-[1px_1px_0_rgba(0,0,0,0.6)]"
        draggable={false}
      />
      <span className="line-clamp-2 text-xs leading-tight [text-shadow:1px_1px_0_#000]">
        {label}
      </span>
    </button>
  );
}
