export const LOCALE_STORAGE_KEY = "bioreserve-locale";
export const SOUND_STORAGE_KEY = "bioreserve-sound-enabled";

export type LocalePreference = "en" | "nl";

const LOCALE_EVENT = "bioreserve-locale-change";
const SOUND_EVENT = "bioreserve-sound-change";

export function readLocale(): LocalePreference {
  if (typeof window === "undefined") return "en";
  const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return value === "nl" ? "nl" : "en";
}

export function writeLocale(locale: LocalePreference): void {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

export function subscribeLocale(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LOCALE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LOCALE_EVENT, onStoreChange);
  };
}

export function readSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const value = window.localStorage.getItem(SOUND_STORAGE_KEY);
  if (value === null) return true;
  return value === "true";
}

export function writeSoundEnabled(enabled: boolean): void {
  window.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function subscribeSound(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SOUND_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SOUND_EVENT, onStoreChange);
  };
}
