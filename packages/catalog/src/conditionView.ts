import * as React from "react";
import { flushSync } from "react-dom";

/**
 * How a reader chose to see conditions, in a project that writes them as expressions: as the
 * visual outline, or as expressions. Every condition on every page shares the choice, and this
 * browser remembers it. The outline shows until the reader chooses.
 */
export type ConditionView = "tree" | "expression";

const STORAGE_KEY = "featurevisor-catalog:conditions";
const listeners = new Set<() => void>();
// the choice for this page view, when storage is unavailable
let chosen: ConditionView | undefined;

function read(): ConditionView {
  if (chosen) return chosen;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "expression" ? "expression" : "tree";
  } catch {
    return "tree";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    chosen = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Switching changes the height of every condition on the page, so the control the reader used
 * would move with the conditions above it. It stays where it was on screen instead.
 */
function keepInPlace(anchor: Element | undefined, change: () => void) {
  if (!anchor) return change();
  const before = anchor.getBoundingClientRect().top;
  change();
  window.scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: "instant" });
}

export function useConditionView(): [
  ConditionView,
  (view: ConditionView, anchor?: Element) => void,
] {
  const view = React.useSyncExternalStore(subscribe, read, () => "tree" as const);
  const choose = React.useCallback((next: ConditionView, anchor?: Element) => {
    chosen = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the choice for this page view even when it cannot be stored.
    }
    // rendered at once, so the anchor's new place can be measured
    keepInPlace(anchor, () => flushSync(() => listeners.forEach((listener) => listener())));
  }, []);
  return [view, choose];
}
