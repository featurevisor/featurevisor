import { Signal } from "signal-polyfill";
import type { Featurevisor } from "@featurevisor/sdk";

import type { Source } from "./engine.js";
import { createReader, type Reader, type ReaderOptions } from "./reader.js";

declare module "./reader.js" {
  interface Wrapped<T> {
    tc39: Signal.Computed<T>;
  }
}

/**
 * A computed signal over a source, following the TC39 Signals proposal through
 * its polyfill. It listens to the SDK only while a watcher watches it.
 */
export function toSignal<T>(source: Source<T>): Signal.Computed<T> {
  let stop: (() => void) | undefined;
  const version = new Signal.State(0, {
    [Signal.subtle.watched]() {
      stop = source.listen(() => version.set(version.get() + 1));
    },
    [Signal.subtle.unwatched]() {
      if (stop) stop();
      stop = undefined;
    },
  });

  return new Signal.Computed(() => {
    version.get();

    return source.read();
  });
}

/** A reader whose values are TC39 computed signals, which work with Lit and plain watchers. */
export function createSignals(f: Featurevisor, options: ReaderOptions = {}): Reader<"tc39"> {
  return createReader<"tc39">(f, toSignal, options);
}
