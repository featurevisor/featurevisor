export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "featurevisor-catalog:theme";
const media =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

export function getThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage can be unavailable in private windows; fall back to the system theme.
  }

  return "system";
}

/** Resolve a preference to the concrete theme set on `<html data-theme>`. */
export function applyTheme(preference: ThemePreference = getThemePreference()) {
  const dark = preference === "dark" || (preference === "system" && Boolean(media?.matches));

  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Keep the choice for this page view even when it cannot be stored.
  }

  applyTheme(preference);
}

/** Follow system changes while the preference is "system". */
export function watchSystemTheme() {
  media?.addEventListener?.("change", () => {
    if (getThemePreference() === "system") applyTheme("system");
  });
}
