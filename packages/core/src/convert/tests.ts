import { Document, isMap, isScalar, isSeq, Pair, Scalar, YAMLMap, YAMLSeq } from "yaml";
import type { Node } from "yaml";

import { isSpaced, nodeAt, pairOf, rootMap, same, seqOf, setKey, spaceItems } from "./documents";

/**
 * Test specs in each shape. Feature, variable and scenario assertions name an environment
 * when the project has environments, and so do segment assertions whose segment depends on
 * a feature or a variable. Children take their parent's environment, so only top level
 * assertions and a scenario's root change.
 */

const PLACEHOLDER = /^\$\{\{\s*([^}]+?)\s*\}\}$/;
const MATRIX_KEY = "environment";

/** The keys an added `matrix` follows, and `environment` after it, in the house order */
const BEFORE_MATRIX = ["key", "description", "promotable"];
const BEFORE_ENVIRONMENT = [...BEFORE_MATRIX, "matrix"];

export type SpecKind = "feature" | "segment" | "variable" | "scenario";

export function specKind(value: unknown): SpecKind {
  const spec = (value || {}) as Record<string, unknown>;
  for (const owner of ["feature", "segment", "variable"] as const) {
    if (Object.prototype.hasOwnProperty.call(spec, owner)) return owner;
  }
  return "scenario";
}

/** The assertions to change: a spec's top level list, or a scenario's root */
function assertionsOf(doc: Document): { list?: YAMLSeq; root?: YAMLMap } {
  const map = rootMap(doc);
  if (!map) return {};
  if (specKind(doc.toJS()) === "scenario") return { root: map };
  return { list: seqOf(nodeAt(map, "assertions")) };
}

function environmentOf(assertion: YAMLMap): unknown {
  const node = nodeAt(assertion, "environment");
  return isScalar(node) ? node.value : undefined;
}

/** Whether anything in an assertion reads the matrix value `key`, as `${{ key }}` */
function readsMatrixKey(assertion: YAMLMap, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\$\\{\\{\\s*${escaped}\\s*\\}\\}`).test(JSON.stringify(assertion.toJSON()));
}

/**
 * Keeps an assertion as it runs in one lane, without `environment`. One that takes its
 * environment from a matrix drops that matrix value, or keeps only the lane in it when other
 * text, such as a description, reads it. False when it does not run in the lane.
 */
function narrowToLane(assertion: YAMLMap, lane: string): boolean {
  const environment = environmentOf(assertion);
  if (environment === undefined) return true;

  const placeholder = typeof environment === "string" && PLACEHOLDER.exec(environment);
  if (placeholder) {
    const key = placeholder[1];
    const matrix = nodeAt(assertion, "matrix");
    const values = isMap(matrix) ? (matrix.get(key, true) as Node | undefined) : undefined;
    if (!isSeq(values) || !(values.toJSON() as unknown[]).includes(lane)) return false;
    assertion.delete("environment");
    if (readsMatrixKey(assertion, key)) {
      values.items = values.items.filter((item) => isScalar(item) && item.value === lane);
    } else {
      (matrix as YAMLMap).delete(key);
      if ((matrix as YAMLMap).items.length === 0) assertion.delete("matrix");
    }
    return true;
  }
  if (environment !== lane) return false;
  assertion.delete("environment");
  return true;
}

/** Moves the comment above a list's first item onto the item, so it goes where the item goes */
function liftListComment(list: YAMLSeq) {
  const first = list.items[0] as Node | undefined;
  if (!list.commentBefore || !first || typeof first !== "object") return;
  first.commentBefore = [list.commentBefore, first.commentBefore].filter(Boolean).join("\n");
  list.commentBefore = undefined;
}

/** Whether a list's items are separated by blank lines */
function isListSpaced(list: YAMLSeq): boolean {
  return list.items.slice(1).some((item) => (item as Node | null)?.spaceBefore);
}

function seqOfLanes(lanes: string[], block = false): YAMLSeq {
  const seq = new YAMLSeq();
  seq.flow = !block;
  for (const lane of lanes) seq.add(new Scalar(lane));
  return seq;
}

/** A spec as it runs in one lane, or undefined when nothing of it runs there */
export function specForLane(doc: Document, lane: string): Document | undefined {
  const copy = doc.clone();
  const { list, root } = assertionsOf(copy);
  if (root) return narrowToLane(root, lane) ? copy : undefined;
  if (!list) return copy;
  const spaced = isListSpaced(list);
  liftListComment(list);
  list.items = list.items.filter((item) => !isMap(item) || narrowToLane(item, lane));
  spaceItems(list, spaced);
  return list.items.length > 0 ? copy : undefined;
}

/**
 * Stands in for the lanes in a set's matrix that held only its own lane, so the sets' specs
 * compare equal and the lanes go back where the matrix had them
 */
const LANES = "\u0000lanes";

/** Whether an assertion's matrix holds only its set's lane, as narrowing left it */
function laneMatrixOf(assertion: YAMLMap, lane?: string): YAMLSeq | undefined {
  if (pairOf(assertion, "environment")) return undefined;
  const matrix = nodeAt(assertion, "matrix");
  const values = isMap(matrix) ? (matrix.get(MATRIX_KEY, true) as Node | undefined) : undefined;
  if (!isSeq(values) || values.items.length !== 1) return undefined;
  const value = (values.items[0] as Scalar | undefined)?.value;
  return value === (lane ?? LANES) ? values : undefined;
}

/** Gives an assertion the lanes it runs in: one by name, several through a matrix */
function giveLanes(assertion: YAMLMap, lanes: string[]): YAMLMap[] {
  const placeholder = new Scalar(`\${{ ${MATRIX_KEY} }}`);
  const laneMatrix = laneMatrixOf(assertion);
  if (laneMatrix) {
    laneMatrix.items = lanes.map((lane) => new Scalar(lane));
    setKey(assertion, "environment", placeholder, BEFORE_ENVIRONMENT);
    return [assertion];
  }
  if (lanes.length === 1) {
    setKey(assertion, "environment", new Scalar(lanes[0]), BEFORE_ENVIRONMENT);
    return [assertion];
  }
  const matrix = nodeAt(assertion, "matrix");
  if (isMap(matrix) && pairOf(matrix, MATRIX_KEY)) {
    // the matrix already uses the name, so each lane gets its own copy
    return lanes.map((lane) => {
      const copy = assertion.clone() as YAMLMap;
      setKey(copy, "environment", new Scalar(lane), BEFORE_ENVIRONMENT);
      return copy;
    });
  }
  if (isMap(matrix)) {
    // lanes lead the matrix, as the values the assertion varies most by, listed as its others are
    const block = (matrix.items as Pair[]).some(({ value }) => isSeq(value) && !value.flow);
    matrix.items.unshift(new Pair(new Scalar(MATRIX_KEY), seqOfLanes(lanes, block)));
  } else {
    const target = new YAMLMap();
    target.set(new Scalar(MATRIX_KEY), seqOfLanes(lanes));
    setKey(assertion, "matrix", target, BEFORE_MATRIX);
  }
  setKey(assertion, "environment", placeholder, BEFORE_ENVIRONMENT);
  return [assertion];
}

/** A spec from a project without environments, made to run in every one of `lanes` */
export function specForLanes(doc: Document, lanes: string[], needsEnvironment: boolean) {
  if (!needsEnvironment) return doc;
  const copy = doc.clone();
  const { list, root } = assertionsOf(copy);
  if (root) {
    giveLanes(root, lanes);
    return copy;
  }
  if (list) {
    const spaced = isListSpaced(list);
    list.items = list.items.flatMap((item) => (isMap(item) ? giveLanes(item, lanes) : [item]));
    spaceItems(list, spaced);
  }
  return copy;
}

/** A set's spec with each matrix holding only the set's lane standing in for the lanes */
function withLaneMatrices(doc: Document, lane: string): Document {
  const copy = doc.clone();
  const { list, root } = assertionsOf(copy);
  for (const assertion of root ? [root] : list?.items || []) {
    if (!isMap(assertion)) continue;
    const values = laneMatrixOf(assertion, lane);
    if (values) (values.items[0] as Scalar).value = LANES;
  }
  return copy;
}

export interface LaneSpec {
  lane: string;
  doc: Document;
}

/**
 * Specs at one path in several sets, as one spec for a project with environments. An
 * assertion several sets share is written once, for those lanes. The result is undefined, with
 * a conflict, when the specs cannot be one file.
 */
export function mergeSpecs(
  specs: LaneSpec[],
  allLanes: string[],
  needsEnvironment: boolean,
): { doc?: Document; conflict?: string; renamed: string[] } {
  const renamed: string[] = [];
  specs = specs.map(({ lane, doc }) => ({ lane, doc: withLaneMatrices(doc, lane) }));
  const first = specs[0].doc;
  const kind = specKind(first.toJS());

  if (kind === "scenario") {
    if (!specs.every(({ doc }) => same(doc.toJS(), first.toJS()))) {
      return { conflict: "the scenario differs between sets", renamed };
    }
    const lanes = specs.map(({ lane }) => lane);
    const copy = first.clone();
    giveLanes(rootMap(copy)!, lanes);
    return { doc: copy, renamed };
  }

  // the parts outside the assertions must agree
  const outside = (doc: Document) => {
    const rest = { ...((doc.toJS() || {}) as Record<string, unknown>) };
    delete rest.assertions;
    return rest;
  };
  if (!specs.every(({ doc }) => same(outside(doc), outside(first)))) {
    return { conflict: "the spec differs between sets outside its assertions", renamed };
  }

  const entries: { node: YAMLMap; lanes: string[] }[] = [];
  for (const { lane, doc } of specs) {
    const list = seqOf(nodeAt(rootMap(doc)!, "assertions"));
    if (list) liftListComment(list);
    for (const item of list?.items || []) {
      if (!isMap(item)) continue;
      const entry = entries.find(({ node }) => same(node.toJSON(), item.toJSON()));
      if (entry) entry.lanes.push(lane);
      else entries.push({ node: item.clone() as YAMLMap, lanes: [lane] });
    }
  }

  // assertions that differ between sets but share a key get the set's name after it
  const keys = new Map<string, number>();
  for (const { node } of entries) {
    const key = node.get("key");
    if (typeof key === "string") keys.set(key, (keys.get(key) || 0) + 1);
  }

  const copy = first.clone();
  const list = seqOf(nodeAt(rootMap(copy)!, "assertions"))!;
  // spaced as any set's list is, or as the spec's keys are when no list says
  const lists = specs.map(({ doc }) => seqOf(nodeAt(rootMap(doc)!, "assertions")));
  const spaced = lists.some((items) => items && items.items.length > 1)
    ? lists.some((items) => items && isListSpaced(items))
    : isSpaced(rootMap(first));
  list.items = entries.flatMap(({ node, lanes }) => {
    const key = node.get("key");
    if (typeof key === "string" && (keys.get(key) || 0) > 1) {
      node.set("key", `${key}-${lanes.join("-")}`);
      renamed.push(key);
    }
    const everywhere = lanes.length === allLanes.length;
    if (!needsEnvironment && everywhere && !laneMatrixOf(node)) return [node];
    return giveLanes(node, lanes);
  });
  spaceItems(list, spaced);
  return { doc: copy, renamed: [...new Set(renamed)] };
}
