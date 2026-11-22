import { batch, computed, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import type { Featurevisor } from "@featurevisor/sdk";

import type { Source } from "./engine.js";
import { createReader, type Reader, type ReaderOptions } from "./reader.js";

declare module "./reader.js" {
  interface Wrapped<T> {
    preact: ReadonlySignal<T>;
  }
}

/**
 * A computed signal over a source. It listens to the SDK only while something
 * watches it, through the signal's watched and unwatched callbacks.
 */
export function toSignal<T>(source: Source<T>): ReadonlySignal<T> {
  let stop: (() => void) | undefined;
  const version = signal(0, {
    watched() {
      stop = source.listen(() => {
        version.value++;
      });
    },
    unwatched() {
      if (stop) stop();
      stop = undefined;
    },
  });

  return computed(() => {
    void version.value;

    return source.read();
  });
}

/** Runs together and untracked, so a change made inside an effect does not tie it to the values. */
function together(run: () => void): void {
  batch(() => untracked(run));
}

/** A reader whose values are Preact signals, updated together in one batch per change. */
export function createSignals(f: Featurevisor, options: ReaderOptions = {}): Reader<"preact"> {
  return createReader<"preact">(
    f,
    toSignal,
    Object.assign({}, options, { batch: options.batch || together }),
  );
}
