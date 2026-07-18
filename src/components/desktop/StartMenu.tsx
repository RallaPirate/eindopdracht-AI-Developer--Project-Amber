"use client";

type StartMenuProps = {
  currentUser: string;
  onChangeUser: () => void;
  onReboot: () => void;
  onClose: () => void;
};

export function StartMenu({
  currentUser,
  onChangeUser,
  onReboot,
  onClose,
}: StartMenuProps) {
  return (
    <div
      className="os-bevel-out absolute bottom-full left-0 mb-0.5 flex min-w-[220px] bg-[var(--os-window-face)] text-sm text-[var(--os-button-text)]"
      role="menu"
    >
      <div className="flex w-7 shrink-0 items-end justify-center bg-[var(--os-titlebar)] py-2">
        <span className="rotate-180 text-xs font-bold tracking-widest text-[var(--os-text)] [writing-mode:vertical-rl]">
          BioReserve OS
        </span>
      </div>
      <div className="flex flex-1 flex-col py-1">
        <div className="cursor-default px-3 py-2">
          <div className="text-[var(--os-disabled)]">Current user</div>
          <div className="truncate font-bold">{currentUser}</div>
        </div>
        <div className="mx-1 border-t border-[var(--os-border-shadow)]" />
        <button
          type="button"
          role="menuitem"
          className="px-3 py-2 text-left hover:bg-[var(--os-titlebar)] hover:text-[var(--os-text)]"
          onClick={() => {
            onClose();
            onChangeUser();
          }}
        >
          Change user
        </button>
        <button
          type="button"
          role="menuitem"
          className="px-3 py-2 text-left hover:bg-[var(--os-titlebar)] hover:text-[var(--os-text)]"
          onClick={() => {
            onClose();
            onReboot();
          }}
        >
          Reboot
        </button>
      </div>
    </div>
  );
}
