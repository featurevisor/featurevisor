import { entityPaths, entityPathToType } from "./entityTypes";
import type { CatalogEntityType, CatalogIndex, EntitySummary } from "./types";

export const SEARCH_RESULT_LIMIT = 30;

export interface SearchResult {
  type: CatalogEntityType;
  key: string;
  description?: string;
  score: number;
  /** Set when the best evidence is an authored value rather than the key or description. */
  match?: { kind: string; value: string };
}

const termKindLabels: Record<string, string> = {
  rule: "Rule",
  override: "Override",
  variation: "Variation",
  variable: "Variable",
  value: "Value",
  assertion: "Assertion",
  alias: "Property",
  source: "Source",
  segment: "Segment",
  feature: "Feature",
  attribute: "Attribute",
  path: "Path",
};

export function getSearchMatchLabel(kind: string) {
  return termKindLabels[kind] || kind;
}

/** Words in keys and prose: separators, camelCase and digit boundaries all split. */
export function tokenize(text: string) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

type Strength = "exact" | "prefix" | "word" | "wordPrefix" | "substring";

interface PreparedText {
  lower: string;
  words: string[];
}

function prepare(text: string): PreparedText {
  return { lower: text.toLowerCase(), words: tokenize(text) };
}

function strengthOf(text: PreparedText, term: string): Strength | undefined {
  if (text.lower === term) return "exact";
  if (text.lower.startsWith(term)) return "prefix";
  if (text.words.includes(term)) return "word";
  if (text.words.some((word) => word.startsWith(term))) return "wordPrefix";
  if (term.length >= 3 && text.lower.includes(term)) return "substring";
  return undefined;
}

/** How strongly one term matches a piece of text. Short terms never match mid word. */
export function matchStrength(text: string, term: string): Strength | undefined {
  return strengthOf(prepare(text), term);
}

const keyScores: Record<Strength, number> = {
  exact: 100,
  prefix: 60,
  word: 50,
  wordPrefix: 35,
  substring: 15,
};
const termScores: Record<Strength, number> = {
  exact: 45,
  prefix: 25,
  word: 25,
  wordPrefix: 18,
  substring: 8,
};
const descriptionScores: Record<Strength, number> = {
  exact: 12,
  prefix: 10,
  word: 10,
  wordPrefix: 6,
  substring: 3,
};

function splitTerm(term: string) {
  const separator = term.indexOf(":");
  return separator > 0
    ? { kind: term.slice(0, separator), value: term.slice(separator + 1) }
    : { kind: "value", value: term };
}

type SearchableEntity = Pick<
  EntitySummary,
  "key" | "description" | "searchTerms" | "variationValues" | "variableKeys"
>;

interface PreparedEntity {
  key: PreparedText;
  description?: PreparedText;
  authored: Array<{ kind: string; value: string; text: PreparedText }>;
}

// Index summaries never change once loaded, so each is lowercased and tokenized only once
// rather than on every keystroke.
const preparedEntities = new WeakMap<SearchableEntity, PreparedEntity>();

function prepareEntity(entity: SearchableEntity): PreparedEntity {
  let prepared = preparedEntities.get(entity);
  if (!prepared) {
    const authored = [
      ...(entity.searchTerms || []).map(splitTerm),
      ...(entity.variationValues || []).map((value) => ({ kind: "variation", value })),
      ...(entity.variableKeys || []).map((value) => ({ kind: "variable", value })),
    ];
    prepared = {
      key: prepare(entity.key),
      description: entity.description ? prepare(entity.description) : undefined,
      authored: authored.map((item) => ({ ...item, text: prepare(item.value) })),
    };
    preparedEntities.set(entity, prepared);
  }
  return prepared;
}

export function scoreEntity(
  entity: SearchableEntity,
  queryTerms: string[],
): Pick<SearchResult, "score" | "match"> | undefined {
  const prepared = prepareEntity(entity);
  let score = 0;
  let match: SearchResult["match"];

  for (const term of queryTerms) {
    const keyStrength = strengthOf(prepared.key, term);
    const descriptionStrength = prepared.description
      ? strengthOf(prepared.description, term)
      : undefined;
    let best = Math.max(
      keyStrength ? keyScores[keyStrength] : 0,
      descriptionStrength ? descriptionScores[descriptionStrength] : 0,
    );
    let bestTerm: SearchResult["match"];

    for (const candidate of prepared.authored) {
      const strength = strengthOf(candidate.text, term);
      if (!strength) continue;
      const candidateScore = termScores[strength];
      if (candidateScore > best) {
        best = candidateScore;
        bestTerm = { kind: candidate.kind, value: candidate.value };
      }
    }

    if (best === 0) return undefined;
    score += best;
    if (bestTerm && !match) match = bestTerm;
  }

  return { score, match };
}

/** Tokenize every summary ahead of the first search. Later searches reuse the cache. */
export function prepareCatalogSearch(index: CatalogIndex) {
  for (const entityPath of entityPaths) {
    for (const entity of index.entities[entityPathToType[entityPath]] || []) prepareEntity(entity);
  }
}

const keyCollator = new Intl.Collator();

export function searchCatalog(index: CatalogIndex, query: string): SearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  // Keep only the best results in order, rather than sorting every match. A short
  // term can match thousands of entities in a large project.
  const best: SearchResult[] = [];
  const before = (left: SearchResult, right: SearchResult) =>
    right.score - left.score || keyCollator.compare(left.key, right.key);
  for (const entityPath of entityPaths) {
    const type = entityPathToType[entityPath];
    for (const entity of index.entities[type] || []) {
      const scored = scoreEntity(entity, terms);
      if (!scored) continue;
      const result = { type, key: entity.key, description: entity.description, ...scored };
      if (best.length === SEARCH_RESULT_LIMIT && before(result, best[best.length - 1]) >= 0)
        continue;
      let position = best.length;
      while (position > 0 && before(result, best[position - 1]) < 0) position--;
      best.splice(position, 0, result);
      if (best.length > SEARCH_RESULT_LIMIT) best.pop();
    }
  }
  return best;
}
