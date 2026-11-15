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
  /**
   * The answer itself, for comparing and sorting: true or false, a variation, a variable's
   * value, or null where an audience gets more than one answer
   */
  value: unknown;
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
  /**
   * Features its conditions require that are partly on for this audience, each with that share.
   * The answer's share is its own rule's share of theirs.
   */
  requires?: Array<{ feature: string; variation?: string; percentage: number }>;
  /**
   * Features a variable's value changes with, by where someone falls in their rollouts, when the
   * person cannot be placed in them. The value shown is one place's. AT, or what those features
   * bucket by, reads one person's.
   */
  depends?: string[];
}

interface Evaluator {
  sdk: Featurevisor;
  /** Where the next evaluation sits in the rollout, or undefined for the person's own bucket */
  position?: number;
  /** Where single features sit instead, to read a required feature's rollout apart */
  positions?: Record<string, number>;
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
          bucketValue: ({ featureKey, bucketValue }) =>
            created.positions?.[featureKey] ?? created.position ?? bucketValue,
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

function apart<T>(
  evaluator: Evaluator,
  positions: Record<string, number> | undefined,
  evaluate: () => T,
): T {
  const previous = evaluator.positions;
  evaluator.positions = positions;
  try {
    return evaluate();
  } finally {
    evaluator.positions = previous;
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

/** A value inside an object or array variable, as `.currency` or `[0]` reads it in conditions */
export function valueAtPath(value: unknown, path: Array<string | number> = []): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current !== null && typeof current === "object"
        ? (current as Record<string | number, unknown>)[key]
        : undefined,
    value,
  );
}

export function formatValue(value: unknown): string {
  if (value === undefined) return "";
  // Empty text shows as such, apart from no value at all
  if (typeof value === "string") return value === "" ? '""' : value;
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
const on = (why: Why): Cell => ({ text: "On", tone: "on", value: true, why });
const off = (why: Why): Cell => ({ text: "Off", tone: "off", value: false, why });

/** The share of the row's audience a flag cell is on for, from 0 to 100 */
export function rolloutOf(cell: Cell): number {
  if (cell.tone === "on") return 100;
  if (cell.tone === "partial") return cell.why.percentage ?? 0;
  return 0;
}

/**
 * Where an evaluation sits in the rollout. An audience is read at the start of it, where every
 * rule above 0% includes it, so the SDK names the rule that matched. Read at an anonymous
 * person's own bucket, a rule whose percentage does not reach it matches nothing at all.
 */
const AUDIENCE_POSITION = 0;

/** The features and variations conditions require, through segments, each once */
function requiredIn(datafile: DatafileContent, conditionsList: unknown[]) {
  const found = new Map<string, { feature: string; variation?: string }>();
  const seen = new Set<string>();
  const walk = (conditions: unknown): void => {
    if (typeof conditions === "string") {
      if (/^\s*[[{]/.test(conditions)) {
        try {
          walk(JSON.parse(conditions));
        } catch {
          // text that is not conditions
        }
      } else if (datafile.segments?.[conditions] && !seen.has(conditions)) {
        seen.add(conditions);
        walk(datafile.segments[conditions].conditions);
      }
      return;
    }
    if (Array.isArray(conditions)) return conditions.forEach(walk);
    if (!conditions || typeof conditions !== "object") return;
    const leaf = conditions as Record<string, unknown>;
    if (typeof leaf.feature === "string") {
      const variation = typeof leaf.variation === "string" ? leaf.variation : undefined;
      found.set(`${leaf.feature}:${variation ?? ""}`, { feature: leaf.feature, variation });
    }
    for (const key of ["and", "or", "not"]) walk(leaf[key]);
  };
  conditionsList.forEach(walk);
  return [...found.values()];
}

/** The features and variations a feature's conditions require, from its own and its rule's */
function requiredOf(datafile: DatafileContent, featureKey: string, ruleKey?: string) {
  const feature = datafile.features?.[featureKey];
  if (!feature) return [];
  const rule = (feature.traffic || []).find((traffic) => traffic.key === ruleKey);
  return requiredIn(datafile, [feature.conditions, rule && (rule.conditions ?? rule.segments)]);
}

/** A place inside each stretch of a feature's rollout its rules and allocations cut */
function placesIn(datafile: DatafileContent, featureKey: string): number[] {
  const cuts = new Set([0, MAX_BUCKETED_NUMBER]);
  for (const traffic of datafile.features?.[featureKey]?.traffic || []) {
    cuts.add(traffic.percentage);
    for (const { range } of traffic.allocation || []) range.forEach((cut) => cuts.add(cut));
  }
  const sorted = [...cuts]
    .filter((cut) => cut >= 0 && cut <= MAX_BUCKETED_NUMBER)
    .sort((a, b) => a - b);
  return sorted.slice(1).map((end, index) => Math.floor((sorted[index] + end) / 2));
}

/**
 * The required features a value changes with, for a person who cannot be placed in their
 * rollouts: each read at a place in every stretch of its rollout, the rest left as they were.
 */
function dependsOn(
  datafile: DatafileContent,
  person: Person,
  required: string[],
  value: unknown,
  read: (positions: Record<string, number>) => unknown,
): string[] {
  if (placement(person).position !== undefined) return [];
  const same = (other: unknown) => JSON.stringify(other) === JSON.stringify(value);
  return [...new Set(required)].filter(
    (key) =>
      datafile.features?.[key] &&
      lensOf(datafile, key, person) === "audience" &&
      placesIn(datafile, key).some((place) => !same(read({ [key]: place }))),
  );
}

/** Features a feature variable's overrides require, in its variations and its rules */
function variableRequires(datafile: DatafileContent, featureKey: string, variableKey: string) {
  const feature = datafile.features?.[featureKey];
  const conditions: unknown[] = [];
  for (const variation of feature?.variations || []) {
    for (const override of variation.variableOverrides?.[variableKey] || [])
      conditions.push(override.conditions ?? override.segments);
  }
  for (const traffic of feature?.traffic || []) {
    const overrides = (traffic as { variableOverrides?: Record<string, unknown[]> })
      .variableOverrides?.[variableKey];
    for (const override of (overrides || []) as Array<Record<string, unknown>>)
      conditions.push(override.conditions ?? override.segments);
  }
  return requiredIn(datafile, conditions)
    .map((item) => item.feature)
    .filter((key) => key !== featureKey);
}

/**
 * The share of an audience the required features let through, each partly on, and their product.
 * Buckets hash each feature's key, so one person's place in two rollouts is independent.
 */
function requiredShares(
  datafile: DatafileContent,
  featureKey: string,
  ruleKey: string | undefined,
  person: Person,
  seen: Set<string>,
) {
  const partial: NonNullable<Why["requires"]> = [];
  let share = 100;
  for (const required of requiredOf(datafile, featureKey, ruleKey)) {
    if (seen.has(required.feature)) continue;
    let percentage: number;
    if (required.variation === undefined) {
      percentage = rolloutOf(flagCell(datafile, required.feature, person, seen));
    } else {
      const cell = variationCell(datafile, required.feature, person, seen);
      percentage =
        cell.why.split?.find((item) => item.variation === required.variation)?.percentage ??
        (cell.variation === required.variation ? (cell.why.percentage ?? 100) : 0);
    }
    if (percentage > 0 && percentage < 100) partial.push({ ...required, percentage });
    share = (share * percentage) / 100;
  }
  return { partial, share };
}

export function flagCell(
  datafile: DatafileContent,
  featureKey: string,
  person: Person,
  seen: Set<string> = new Set(),
): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const lens = lensOf(datafile, featureKey, person);
  const evaluation = at(evaluator, lens === "audience" ? AUDIENCE_POSITION : position, () =>
    evaluator.sdk.evaluateFlag(featureKey, context),
  );
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
    const own =
      typeof traffic.enabled === "boolean"
        ? traffic.enabled
          ? 100
          : 0
        : percent(traffic.percentage);
    // Read with every required feature on, so their shares narrow it
    const required =
      own > 0
        ? requiredShares(
            datafile,
            featureKey,
            evaluation.ruleKey,
            person,
            new Set([...seen, featureKey]),
          )
        : undefined;
    const share = Math.round(((own * (required?.share ?? 100)) / 100) * 10) / 10;
    if (required?.partial.length) why.requires = required.partial;
    if (typeof traffic.enabled !== "boolean" || why.requires) why.percentage = share;
    if (share >= 100) return on(why);
    if (share <= 0) return off(why);
    return { text: formatPercent(share), tone: "partial", value: null, why };
  }
  return evaluation.enabled ? on(why) : off(why);
}

/** The variation the person gets, or the audience's split between variations */
export function variationCell(
  datafile: DatafileContent,
  featureKey: string,
  person: Person,
  seen: Set<string> = new Set(),
): Cell {
  const flag = flagCell(datafile, featureKey, person, seen);
  if (flag.tone === "off") return { ...flag, text: "Off", value: null };
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const audience = flag.why.lens === "audience";
  const evaluation = at(evaluator, audience ? AUDIENCE_POSITION : position, () =>
    evaluator.sdk.evaluateVariation(featureKey, context),
  );
  const why: Why = { ...flag.why, reason: evaluation.reason, ruleKey: evaluation.ruleKey };
  const fixed = evaluation.traffic?.variation;
  if (flag.why.lens === "audience" && !fixed && evaluation.reason !== "forced") {
    // Required features partly on narrow every variation's share alike
    const narrowed = (flag.why.requires || []).reduce(
      (share, item) => (share * item.percentage) / 100,
      100,
    );
    const split = splitOf(evaluation)?.map((item) => ({
      ...item,
      percentage: Math.round(((item.percentage * narrowed) / 100) * 10) / 10,
    }));
    if (split && split.length > 1) {
      why.split = split;
      return {
        text: split
          .map((share) => `${share.variation} ${formatPercent(share.percentage)}`)
          .join(" · "),
        tone: "partial",
        value: null,
        why,
      };
    }
  }
  const variation = evaluation.variationValue ?? evaluation.variation?.value;
  return variation === undefined
    ? { text: "None", tone: "none", value: null, why }
    : {
        text: String(variation),
        tone: "value",
        variation: String(variation),
        value: String(variation),
        why,
      };
}

/** A feature's own variable, for the person, or per variation across the audience's split */
export function featureVariableCell(
  datafile: DatafileContent,
  featureKey: string,
  variableKey: string,
  person: Person,
  path: Array<string | number> = [],
): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const variation = variationCell(datafile, featureKey, person);

  const valueAt = (place: number | undefined) =>
    at(evaluator, place, () => evaluator.sdk.evaluateVariable(featureKey, variableKey, context));
  const required = variableRequires(datafile, featureKey, variableKey);
  // Read the value where each variation is allocated, so every variation's value shows
  const split = variation.why.split;
  if (split && variation.why.lens === "audience") {
    // The variation's own evaluation carries the rule's allocation, even where this bucket is off
    const allocation =
      at(evaluator, AUDIENCE_POSITION, () => evaluator.sdk.evaluateVariation(featureKey, context))
        .traffic?.allocation || [];
    const depends = new Set<string>();
    const values = split.map((share) => {
      const range = allocation.find((item) => item.variation === share.variation)?.range;
      const middle = range ? Math.floor((range[0] + range[1]) / 2) : undefined;
      const evaluated = valueAt(middle);
      const raw = valueAtPath(evaluated.variableValue, path);
      // The variation stays where it is while a feature its overrides require moves
      dependsOn(datafile, person, required, raw, (positions) =>
        valueAtPath(apart(evaluator, positions, () => valueAt(middle)).variableValue, path),
      ).forEach((key) => depends.add(key));
      return { ...share, raw, value: formatValue(raw), overrideKey: evaluated.variableOverrideKey };
    });
    // An override every variation's value came from is the answer's own
    const overrides = new Set(values.map((share) => share.overrideKey));
    const why: Why = {
      ...variation.why,
      split: values.map(({ variation, percentage, value }) => ({ variation, percentage, value })),
      ...(overrides.size === 1 && values[0].overrideKey
        ? { overrideKey: values[0].overrideKey }
        : {}),
      ...(depends.size ? { depends: [...depends] } : {}),
    };
    if (new Set(values.map((share) => share.value)).size === 1) {
      return { text: values[0].value, tone: "value", value: values[0].raw, why };
    }
    return {
      text: values.map((share) => `${share.variation}: ${share.value}`).join(" · "),
      tone: "partial",
      value: null,
      why,
    };
  }
  const evaluation = valueAt(position);
  const value = valueAtPath(evaluation.variableValue, path);
  const depends = dependsOn(datafile, person, required, value, (positions) =>
    valueAtPath(apart(evaluator, positions, () => valueAt(position)).variableValue, path),
  );
  return {
    text: formatValue(value),
    tone: "value",
    value,
    why: {
      ...variation.why,
      ...(depends.length ? { lens: "audience" as const, depends } : {}),
      reason: evaluation.reason,
      overrideKey: evaluation.variableOverrideKey,
    },
  };
}

/**
 * A global variable's value. Overrides have no rollouts, so the answer is exact for everyone,
 * unless an override requires a feature the person cannot be placed in.
 */
export function globalVariableCell(
  datafile: DatafileContent,
  variableKey: string,
  person: Person,
  path: Array<string | number> = [],
): Cell {
  const evaluator = evaluatorOf(datafile);
  const { context, position } = placement(person);
  const read = () =>
    at(evaluator, position, () => evaluator.sdk.evaluateVariable(variableKey, context));
  const evaluation = read();
  const value = valueAtPath(evaluation.variableValue, path);
  // Overrides that require a feature change with where someone falls in its rollout
  const variable = datafile.variables?.[variableKey] as
    | { conditions?: unknown; overrides?: Array<{ conditions?: unknown }> }
    | undefined;
  const required = requiredIn(datafile, [
    variable?.conditions,
    ...(variable?.overrides || []).map((override) => override.conditions),
  ]).map((item) => item.feature);
  const depends = dependsOn(datafile, person, required, value, (positions) =>
    valueAtPath(apart(evaluator, positions, read).variableValue, path),
  );
  // Placed in every rollout it follows, by AT or by what they bucket by, it is one person's
  const followed = [...new Set(required)].filter((key) => datafile.features?.[key]);
  const placed =
    followed.length > 0 && followed.every((key) => lensOf(datafile, key, person) === "person");
  return {
    text: formatValue(value),
    tone: "value",
    value,
    why: {
      lens: depends.length ? "audience" : placed ? "person" : "exact",
      reason: evaluation.reason,
      overrideKey: evaluation.variableOverrideKey,
      ...(placed && typeof person.at === "number" ? { at: person.at } : {}),
      ...(depends.length ? { depends } : {}),
    },
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
 * just the conditions of those features or global variables, and the segments they use. Values
 * keep their type, so a person varied by `loggedIn` gets `true`, not the text "true".
 */
export function getComparedValues(
  datafiles: DatafileContent[],
  only?: { features?: string[]; variables?: string[] },
  /** Collects every feature walked: those named, and those their conditions require */
  walked?: Set<string>,
): Map<string, unknown[]> {
  const found = new Map<string, Map<string, unknown>>();
  const add = (attribute: string, value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      return;
    const values = found.get(attribute) || new Map<string, unknown>();
    values.set(`${typeof value}:${String(value)}`, value);
    found.set(attribute, values);
  };
  for (const datafile of datafiles) {
    const visited = new Set<string>();
    const visitedFeatures = new Set<string>();
    const walkFeature = (key: string) => {
      const feature = datafile.features?.[key];
      if (!feature || visitedFeatures.has(key)) return;
      visitedFeatures.add(key);
      walked?.add(key);
      walk(feature.conditions);
      (feature.traffic || []).forEach((traffic) => walk(traffic.conditions ?? traffic.segments));
      (feature.force || []).forEach((force) => walk(force.conditions ?? force.segments));
      // a variation's variables can differ by condition too
      for (const variation of feature.variations || []) {
        for (const overrides of Object.values(variation.variableOverrides || {})) {
          overrides.forEach((override) => walk(override.conditions ?? override.segments));
        }
      }
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
      // Its own conditions decide too, such as a feature it requires
      walk((variable as { conditions?: unknown }).conditions);
      (variable.overrides || []).forEach((override) => walk(override.conditions));
    }
  }
  return new Map([...found].map(([attribute, values]) => [attribute, [...values.values()]]));
}
