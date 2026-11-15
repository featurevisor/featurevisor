import { createFeaturevisor, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";
import type { Evaluation, Featurevisor } from "@featurevisor/sdk";
import type { BucketBy, Context, DatafileContent } from "@featurevisor/types";

/**
 * Evaluates features and global variables for the Query page with the real SDK, against the
 * datafiles the export holds, so a report says exactly what an application would get.
 *
 * A person without the attributes a feature buckets by, usually `userId`, is read as an
 * audience: a rule at 50% shows 50%, and an experiment its split. With them, or with a rollout
 * position written as test specs write `at`, it is one person's exact answer.
 */

/** A person: attribute values, plus `at`, a rollout position from 0 to 100 as in test specs */
export type Person = Record<string, unknown>;

export type Lens = "audience" | "person";

export type CellTone = "on" | "off" | "partial" | "value" | "none";

/** What a report cell shows, and why, for the panel a click opens */
export interface Cell {
  text: string;
  tone: CellTone;
  /** The variation it shows, so every cell colours a variation alike */
  variation?: string;
  why: Why;
}

export interface Why {
  lens: Lens | "exact";
  reason: string;
  ruleKey?: string;
  forced?: boolean;
  /** Share of the row's audience the matched rule enables, from 0 to 100 */
  percentage?: number;
  /** How the enabled share splits between variations, each from 0 to 100 of the whole row */
  split?: Array<{ variation: string; percentage: number; value?: string }>;
  overrideKey?: string;
  at?: number;
  /** What the feature buckets by, such as `userId`, which places one person in its rollout */
  bucketBy?: string;
}

interface Evaluator {
  sdk: Featurevisor;
  /** Where the next evaluation sits in the rollout, or undefined for the person's own bucket */
  position?: number;
}

const evaluators = new WeakMap<DatafileContent, Evaluator>();

function evaluatorOf(datafile: DatafileContent): Evaluator {
  let evaluator = evaluators.get(datafile);
  if (!evaluator) {
    const created = { position: undefined } as Evaluator;
    created.sdk = createFeaturevisor({
      datafile,
      logLevel: "fatal",
      // Places an evaluation in the rollout, as the test runner does for `at`
      modules: [
        {
          name: "catalog-query",
          bucketValue: ({ bucketValue }) => created.position ?? bucketValue,
        },
      ],
    });
    evaluators.set(datafile, created);
    evaluator = created;
  }
  return evaluator;
}

function at<T>(evaluator: Evaluator, position: number | undefined, evaluate: () => T): T {
  const previous = evaluator.position;
  evaluator.position = position;
  try {
    return evaluate();
  } finally {
    evaluator.position = previous;
  }
}

/** The person's context, without `at`, and where they sit in a rollout when they say */
function placement(person: Person) {
  const { at: position, ...context } = person;
  return {
    context: context as Context,
    position: typeof position === "number" ? position * (MAX_BUCKETED_NUMBER / 100) : undefined,
  };
}

function knowsBucket(context: Context, bucketBy: BucketBy | undefined): boolean {
  if (bucketBy === undefined) return true;
  const has = (attribute: string) => context[attribute] !== undefined;
  if (typeof bucketBy === "string") return has(bucketBy);
  if (Array.isArray(bucketBy)) return bucketBy.every(has);
  return bucketBy.or.some(has);
}

function describeBucketBy(bucketBy: BucketBy | undefined): string | undefined {
  if (bucketBy === undefined) return undefined;
  if (typeof bucketBy === "string") return bucketBy;
  if (Array.isArray(bucketBy)) return bucketBy.join(" and ");
  return bucketBy.or.join(" or ");
}

/** Whether a feature's answer for this person is theirs alone, or their audience's */
export function lensOf(datafile: DatafileContent, featureKey: string, person: Person): Lens {
  const { context, position } = placement(person);
  if (position !== undefined) return "person";
  return knowsBucket(context, datafile.features[featureKey]?.bucketBy) ? "person" : "audience";
}

const percent = (value: number) => Math.round((value / MAX_BUCKETED_NUMBER) * 1000) / 10;

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Variations by share of the rule's audience, merging a variation allocated more than once */
function splitOf(evaluation: Evaluation): Why["split"] {
  const allocation = evaluation.traffic?.allocation;
  if (!allocation?.length) return undefined;
  const shares = new Map<string, number>();
  for (const { variation, range } of allocation) {
    shares.set(variation, (shares.get(variation) || 0) + percent(range[1] - range[0]));
  }
  return [...shares].map(([variation, percentage]) => ({ variation, percentage }));
}

/** Whether the feature is on: for the person, or the share of the row's audience */
export function flagCell(datafile: DatafileContent, featureKey: string, person: Person): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const lens = lensOf(datafile, featureKey, person);
  const evaluation = at(evaluator, position, () => evaluator.sdk.evaluateFlag(featureKey, context));
  const why: Why = {
    lens,
    reason: evaluation.reason,
    ruleKey: evaluation.ruleKey,
    forced: evaluation.reason === "forced" || undefined,
    at: typeof person.at === "number" ? person.at : undefined,
    bucketBy: describeBucketBy(datafile.features[featureKey]?.bucketBy),
  };
  const traffic = evaluation.traffic;
  // A rule decides the audience's share with its percentage, unless it turns the feature on or off
  if (lens === "audience" && evaluation.reason === "rule" && traffic) {
    if (typeof traffic.enabled === "boolean") {
      return { text: traffic.enabled ? "On" : "Off", tone: traffic.enabled ? "on" : "off", why };
    }
    const share = percent(traffic.percentage);
    why.percentage = share;
    if (share >= 100) return { text: "On", tone: "on", why };
    if (share <= 0) return { text: "Off", tone: "off", why };
    return { text: formatPercent(share), tone: "partial", why };
  }
  return evaluation.enabled ? { text: "On", tone: "on", why } : { text: "Off", tone: "off", why };
}

/** The variation the person gets, or the audience's split between variations */
export function variationCell(datafile: DatafileContent, featureKey: string, person: Person): Cell {
  const flag = flagCell(datafile, featureKey, person);
  if (flag.tone === "off") return { ...flag, text: "Off" };
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const evaluation = at(evaluator, position, () =>
    evaluator.sdk.evaluateVariation(featureKey, context),
  );
  const why: Why = { ...flag.why, reason: evaluation.reason, ruleKey: evaluation.ruleKey };
  const fixed = evaluation.traffic?.variation;
  if (flag.why.lens === "audience" && !fixed && evaluation.reason !== "forced") {
    const split = splitOf(evaluation);
    if (split && split.length > 1) {
      why.split = split;
      return {
        text: split
          .map((share) => `${share.variation} ${formatPercent(share.percentage)}`)
          .join(" · "),
        tone: "partial",
        why,
      };
    }
  }
  const variation = evaluation.variationValue ?? evaluation.variation?.value;
  return variation === undefined
    ? { text: "None", tone: "none", why }
    : { text: String(variation), tone: "value", variation: String(variation), why };
}

/** A feature's own variable, for the person, or per variation across the audience's split */
export function featureVariableCell(
  datafile: DatafileContent,
  featureKey: string,
  variableKey: string,
  person: Person,
): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const variation = variationCell(datafile, featureKey, person);
  const valueAt = (place: number | undefined) =>
    at(evaluator, place, () => evaluator.sdk.evaluateVariable(featureKey, variableKey, context));
  // Read the value where each variation is allocated, so every variation's value shows
  const split = variation.why.split;
  if (split && variation.why.lens === "audience") {
    const allocation = valueAt(undefined).traffic?.allocation || [];
    const values = split.map((share) => {
      const range = allocation.find((item) => item.variation === share.variation)?.range;
      const middle = range ? Math.floor((range[0] + range[1]) / 2) : undefined;
      return { ...share, value: formatValue(valueAt(middle).variableValue) };
    });
    const why = { ...variation.why, split: values };
    if (new Set(values.map((share) => share.value)).size === 1) {
      return { text: values[0].value, tone: "value", why };
    }
    return {
      text: values.map((share) => `${share.variation}: ${share.value}`).join(" · "),
      tone: "partial",
      why,
    };
  }
  const evaluation = valueAt(position);
  return {
    text: formatValue(evaluation.variableValue),
    tone: "value",
    why: {
      ...variation.why,
      reason: evaluation.reason,
      overrideKey: evaluation.variableOverrideKey,
    },
  };
}

/** A global variable's value. Overrides have no rollouts, so the answer is exact for everyone. */
export function globalVariableCell(
  datafile: DatafileContent,
  variableKey: string,
  person: Person,
): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const evaluation = at(evaluator, position, () =>
    evaluator.sdk.evaluateVariable(variableKey, context),
  );
  return {
    text: formatValue(evaluation.variableValue),
    tone: "value",
    why: { lens: "exact", reason: evaluation.reason, overrideKey: evaluation.variableOverrideKey },
  };
}

/** A value no condition compares with, standing for everyone the conditions do not mention */
export const ANY_OTHER = "(any other)";

/**
 * Operators that pick out exact values, so each value compared is a behaviour of its own. Range
 * operators such as `before` or `greaterThan` compare boundaries, which make poor rows.
 */
const EXACT_OPERATORS = ["equals", "notEquals", "in", "notIn"];

/**
 * The values the project's conditions compare each attribute with, read from the datafiles, so
 * varying a person by an attribute gives every distinct behaviour a row of its own. With `only`,
 * just the conditions of those features or global variables, and the segments they use.
 */
export function getComparedValues(
  datafiles: DatafileContent[],
  only?: { features?: string[]; variables?: string[] },
): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  const add = (attribute: string, value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      return;
    const set = values.get(attribute) || new Set<string>();
    set.add(String(value));
    values.set(attribute, set);
  };
  for (const datafile of datafiles) {
    const visited = new Set<string>();
    const visitedFeatures = new Set<string>();
    const walkFeature = (key: string) => {
      const feature = datafile.features?.[key];
      if (!feature || visitedFeatures.has(key)) return;
      visitedFeatures.add(key);
      walk(feature.conditions);
      (feature.traffic || []).forEach((traffic) => walk(traffic.conditions ?? traffic.segments));
      (feature.force || []).forEach((force) => walk(force.conditions ?? force.segments));
    };
    const walk = (conditions: unknown): void => {
      if (typeof conditions === "string") {
        // a datafile may hold conditions as JSON text, and names segments by their keys
        if (/^\s*[[{]/.test(conditions)) {
          try {
            walk(JSON.parse(conditions));
          } catch {
            // text that is not conditions
          }
        } else if (only && datafile.segments?.[conditions] && !visited.has(conditions)) {
          visited.add(conditions);
          walk(datafile.segments[conditions].conditions);
        }
        return;
      }
      if (Array.isArray(conditions)) return conditions.forEach(walk);
      if (!conditions || typeof conditions !== "object") return;
      const leaf = conditions as Record<string, unknown>;
      if (typeof leaf.attribute === "string" && EXACT_OPERATORS.includes(String(leaf.operator))) {
        for (const value of Array.isArray(leaf.value) ? leaf.value : [leaf.value]) {
          add(leaf.attribute, value);
        }
      }
      // a feature a condition requires decides too, so its conditions count
      if (only && typeof leaf.feature === "string") walkFeature(leaf.feature);
      for (const key of ["and", "or", "not"]) walk(leaf[key]);
    };
    if (!only)
      Object.values(datafile.segments || {}).forEach((segment) => walk(segment.conditions));
    for (const key of Object.keys(datafile.features || {})) {
      if (!only || only.features?.includes(key)) walkFeature(key);
    }
    for (const [key, variable] of Object.entries(datafile.variables || {})) {
      if (only && !only.variables?.includes(key)) continue;
      (variable.overrides || []).forEach((override) => walk(override.conditions));
    }
  }
  return values;
}
