import type { Batch, Source } from "./engine.js";

/** The state of a value a promise away. */
export type AsyncValue<T> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; value: T }
  | { status: "failed"; error: unknown };

export interface AsyncOptions<I> {
  /** The input, read like any signal. `undefined` or `null` means no input, and the value is idle. */
  input: () => I | undefined | null;
  /** Milliseconds the input must stay the same before loading. */
  debounce?: number;
  /** How inputs are told apart. Strings and numbers by value, anything else by its JSON. */
  key?: (input: I) => string;
}

export type AsyncLoad<T, I> = (
  input: I,
  helpers: { signal: AbortSignal | undefined },
) => T | Promise<T>;

const IDLE: AsyncValue<never> = { status: "idle" };
const PENDING: AsyncValue<never> = { status: "pending" };

/**
 * Loads for the latest input only. A newer input aborts the older load through
 * its signal, and an older answer arriving late is dropped. A ready answer is
 * kept for its input, so returning to it asks nothing, and a failure is not
 * kept. Nothing loads while nothing listens, so a server never waits.
 */
export class AsyncNode<T, I> implements Source<AsyncValue<T>> {
  private state: AsyncValue<T> = IDLE;
  private key: string | undefined;
  private input: I | undefined;
  private answers = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private listeners: Array<() => void> = [];

  constructor(
    private readonly load: AsyncLoad<T, I>,
    private readonly options: AsyncOptions<I>,
    private readonly batch?: Batch,
  ) {}

  read = (): AsyncValue<T> => {
    const input = this.options.input();
    const key = input === undefined || input === null ? undefined : this.keyOf(input);
    if (key !== this.key) this.change(input === null ? undefined : input, key);

    return this.state;
  };

  listen = (changed: () => void): (() => void) => {
    this.listeners.push(changed);

    // Starting to listen starts the load that waited for it.
    if (this.listeners.length === 1 && this.key !== undefined && this.state === IDLE) {
      this.state = PENDING;
      this.schedule(this.key, this.input as I);
      Promise.resolve().then(() => this.emit());
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.listeners.indexOf(changed);
      if (index !== -1) this.listeners.splice(index, 1);
      if (this.listeners.length === 0) {
        this.cancel();
        if (this.state === PENDING) this.state = IDLE;
      }
    };
  };

  private keyOf(input: I): string {
    if (this.options.key) return this.options.key(input);
    if (typeof input === "string") return `s:${input}`;
    if (typeof input === "number" || typeof input === "boolean") return `${typeof input}:${input}`;

    return `j:${JSON.stringify(input)}`;
  }

  private change(input: I | undefined, key: string | undefined): void {
    this.cancel();
    this.key = key;
    this.input = input;

    if (key === undefined) {
      this.state = IDLE;
    } else if (this.answers.has(key)) {
      this.state = { status: "ready", value: this.answers.get(key) as T };
    } else if (this.listeners.length === 0) {
      this.state = IDLE;
    } else {
      this.state = PENDING;
      this.schedule(key, input as I);
    }
  }

  private schedule(key: string, input: I): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.start(key, input);
    }, this.options.debounce || 0);
  }

  private start(key: string, input: I): void {
    if (key !== this.key) return;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    this.controller = controller;

    Promise.resolve()
      .then(() => this.load(input, { signal: controller ? controller.signal : undefined }))
      .then(
        (value) => {
          if (key !== this.key || controller !== this.controller) return;
          this.controller = undefined;
          this.answers.set(key, value);
          this.settle({ status: "ready", value });
        },
        (error) => {
          if (key !== this.key || controller !== this.controller) return;
          this.controller = undefined;
          this.settle({ status: "failed", error });
        },
      );
  }

  private cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.controller) {
      this.controller.abort();
      this.controller = undefined;
    }
  }

  private settle(state: AsyncValue<T>): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    const run = () => {
      for (const listener of this.listeners.slice()) {
        try {
          listener();
        } catch (error) {
          console.error(error);
        }
      }
    };
    if (this.batch) this.batch(run);
    else run();
  }
}
