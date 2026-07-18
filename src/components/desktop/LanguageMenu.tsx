"use client";

import type { LocalePreference } from "@/lib/preferences";

type LanguageMenuProps = {
  locale: LocalePreference;
  onSelect: (locale: LocalePreference) => void;
};

export function LanguageMenu({ locale, onSelect }: LanguageMenuProps) {
  return (
    <div
      className="os-bevel-out absolute bottom-full right-0 mb-0.5 min-w-[160px] bg-[var(--os-window-face)] py-1 text-sm text-[var(--os-button-text)]"
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--os-titlebar)] hover:text-[var(--os-text)] ${
          locale === "en" ? "font-bold" : ""
        }`}
        onClick={() => onSelect("en")}
      >
        English
      </button>
      <button
        type="button"
        role="menuitem"
        className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--os-titlebar)] hover:text-[var(--os-text)] ${
          locale === "nl" ? "font-bold" : ""
        }`}
        onClick={() => onSelect("nl")}
      >
        Dutch (Nederlands)
      </button>
    </div>
  );
}
