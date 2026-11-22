import { unref, type Ref } from "vue";
import type { Context } from "@featurevisor/types";

/**
 * The context for a read: an object, a ref holding one, or a getter such as
 * `() => ({ plan: props.plan })`. Refs and getters are followed, so the value
 * updates when what they read changes.
 */
export type ContextSource = Context | Readonly<Ref<Context>> | (() => Context);

const EMPTY_CONTEXT: Context = {};

/** Reads a context source. Inside a computed, its refs and props are tracked. */
export function readContext(source: ContextSource | undefined): Context {
  if (typeof source === "function") return source();

  return unref(source) || EMPTY_CONTEXT;
}
