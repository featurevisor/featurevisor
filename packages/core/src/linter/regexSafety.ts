/**
 * Detects regular expressions that backtracking engines evaluate in exponential time.
 *
 * Go and Rust use linear time engines, but the other SDKs backtrack, so a pattern
 * such as `(a+)+` lets a short context value block evaluation for seconds.
 * Only shapes that are certainly ambiguous are reported, so common delimited
 * patterns such as `([a-z]+\.)+[a-z]+` remain valid:
 *
 * - a repeated group whose body is one repeated element plus parts it can absorb,
 *   such as `(a+)+`, `(\w+\s?)*` or `((ab)+)+`
 * - a repeated group with a single character alternative and another alternative
 *   made only of those characters, such as `(a|aa)+` or `(\w|\d)*`
 *
 * The pattern must already compile with `new RegExp` and use the portable subset,
 * which has no lookaround, noncapturing groups or backreferences.
 */

const OTHER = 128;
type CharSet = boolean[];

interface Item {
  node: Node;
  min: number;
  max: number;
}
type Node =
  | { kind: "chars"; set: CharSet }
  | { kind: "empty" }
  | { kind: "group"; alternatives: Item[][]; source: string };

function emptySet(): CharSet {
  return new Array(OTHER + 1).fill(false);
}
function fullSet(): CharSet {
  return new Array(OTHER + 1).fill(true);
}
function setOf(codes: number[]): CharSet {
  const set = emptySet();
  for (const code of codes) set[code < OTHER ? code : OTHER] = true;
  return set;
}
function range(from: number, to: number): number[] {
  const codes: number[] = [];
  for (let code = from; code <= Math.min(to, OTHER); code++) codes.push(code);
  return codes;
}
function union(a: CharSet, b: CharSet): CharSet {
  return a.map((value, index) => value || b[index]);
}
function complement(a: CharSet): CharSet {
  // Non ASCII stays possible on both sides of a negation.
  return a.map((value, index) => index === OTHER || !value);
}
function subset(a: CharSet, b: CharSet): boolean {
  return a.every((value, index) => !value || b[index]);
}
function isEmptySet(a: CharSet): boolean {
  return a.every((value) => !value);
}

const digits = () => setOf(range(48, 57));
const word = () => setOf([...range(48, 57), ...range(65, 90), ...range(97, 122), 95]);
const space = () => setOf([9, 10, 11, 12, 13, 32, OTHER]);

function escapeSet(letter: string): CharSet | undefined {
  switch (letter) {
    case "d":
      return digits();
    case "D":
      return complement(digits());
    case "w":
      return word();
    case "W":
      return complement(word());
    case "s":
      return space();
    case "S":
      return complement(space());
    case "n":
      return setOf([10]);
    case "r":
      return setOf([13]);
    case "t":
      return setOf([9]);
    case "f":
      return setOf([12]);
    case "v":
      return setOf([11]);
    case "0":
      return setOf([0]);
    case "x":
    case "u":
    case "c":
      return undefined;
    default:
      return setOf([letter.charCodeAt(0)]);
  }
}

class Parser {
  private index = 0;
  constructor(private readonly pattern: string) {}

  parse(): Item[][] {
    return this.alternatives();
  }

  private alternatives(): Item[][] {
    const alternatives: Item[][] = [[]];
    while (this.index < this.pattern.length) {
      const char = this.pattern[this.index];
      if (char === ")") break;
      if (char === "|") {
        this.index++;
        alternatives.push([]);
        continue;
      }
      const start = this.index;
      const item = this.quantified(this.atom());
      if (item.node.kind === "group") item.node.source = this.pattern.slice(start, this.index);
      alternatives[alternatives.length - 1].push(item);
    }
    return alternatives;
  }

  private atom(): Node {
    const char = this.pattern[this.index++];
    if (char === "(") {
      const start = this.index - 1;
      const alternatives = this.alternatives();
      this.index++; // closing parenthesis
      return { kind: "group", alternatives, source: this.pattern.slice(start, this.index) };
    }
    if (char === "^" || char === "$") return { kind: "empty" };
    if (char === ".") return { kind: "chars", set: complement(setOf([10, 13])) };
    if (char === "[") return { kind: "chars", set: this.characterClass() };
    if (char === "\\") {
      const letter = this.pattern[this.index++];
      if (letter === "b" || letter === "B") return { kind: "empty" };
      if (letter === "x") {
        this.index += 2;
        return { kind: "chars", set: fullSet() };
      }
      if (letter === "u") {
        if (this.pattern[this.index] === "{")
          this.index = this.pattern.indexOf("}", this.index) + 1;
        else this.index += 4;
        return { kind: "chars", set: fullSet() };
      }
      if (letter === "c") {
        this.index++;
        return { kind: "chars", set: fullSet() };
      }
      return { kind: "chars", set: escapeSet(letter) || fullSet() };
    }
    return { kind: "chars", set: setOf([char.charCodeAt(0)]) };
  }

  private characterClass(): CharSet {
    let negated = false;
    if (this.pattern[this.index] === "^") {
      negated = true;
      this.index++;
    }
    let set = emptySet();
    while (this.index < this.pattern.length) {
      const char = this.pattern[this.index];
      // Any unescaped `]` closes the class, including a first one as in JavaScript `[]`.
      if (char === "]") break;
      let low: number | CharSet;
      if (char === "\\") {
        const letter = this.pattern[this.index + 1];
        this.index += 2;
        const escaped = escapeSet(letter);
        if (letter === "x" || letter === "u" || letter === "c" || !escaped) {
          if (letter === "x") this.index += 2;
          else if (letter === "u") this.index += 4;
          else if (letter === "c") this.index += 1;
          set = fullSet();
          continue;
        }
        low = escaped;
      } else {
        low = char.charCodeAt(0);
        this.index++;
      }
      if (
        typeof low === "number" &&
        this.pattern[this.index] === "-" &&
        this.pattern[this.index + 1] !== "]" &&
        this.index + 1 < this.pattern.length
      ) {
        this.index++;
        let high = this.pattern.charCodeAt(this.index);
        if (this.pattern[this.index] === "\\") {
          const escaped = escapeSet(this.pattern[this.index + 1]);
          high = escaped ? escaped.indexOf(true) : OTHER;
          this.index++;
        }
        this.index++;
        set = union(set, setOf(range(low, high)));
        if (high >= OTHER) set[OTHER] = true;
      } else {
        set = union(set, typeof low === "number" ? setOf([low]) : low);
      }
    }
    this.index++; // closing bracket
    return negated ? complement(set) : set;
  }

  private quantified(node: Node): Item {
    const char = this.pattern[this.index];
    let min = 1;
    let max = 1;
    if (char === "*" || char === "+" || char === "?") {
      this.index++;
      min = char === "+" ? 1 : 0;
      max = char === "?" ? 1 : Infinity;
    } else if (char === "{") {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(this.pattern.slice(this.index));
      if (!match) return { node, min, max };
      this.index += match[0].length;
      min = Number(match[1]);
      max = match[2] === undefined ? min : match[3] === "" ? Infinity : Number(match[3]);
    } else {
      return { node, min, max };
    }
    if (this.pattern[this.index] === "?") this.index++;
    return { node, min, max };
  }
}

function nullable(item: Item): boolean {
  if (item.min === 0) return true;
  const { node } = item;
  if (node.kind === "empty") return true;
  if (node.kind === "chars") return false;
  return node.alternatives.some((alternative) => alternative.every(nullable));
}

function chars(node: Node): CharSet {
  if (node.kind === "empty") return emptySet();
  if (node.kind === "chars") return node.set;
  let set = emptySet();
  for (const alternative of node.alternatives)
    for (const item of alternative) set = union(set, chars(item.node));
  return set;
}

const repeats = (item: Item) => item.max === Infinity || item.max >= 10;

/** The group can split one input across its iterations in more than one way. */
function ambiguousBody(group: Extract<Node, { kind: "group" }>): boolean {
  for (const alternative of group.alternatives) {
    for (const item of alternative) {
      if (!repeats(item) || nullable({ ...item, min: 1 }) || isEmptySet(chars(item.node))) continue;
      const own = chars(item.node);
      const absorbable = alternative.every(
        (other) => other === item || nullable(other) || subset(chars(other.node), own),
      );
      if (absorbable) return true;
    }
  }
  // A single character alternative plus another alternative made of its characters.
  return group.alternatives.some(
    (alternative, index) =>
      !alternative.every(nullable) &&
      group.alternatives.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length === 1 &&
          other[0].min === 1 &&
          other[0].max === 1 &&
          other[0].node.kind === "chars" &&
          alternative.every((item) => subset(chars(item.node), chars(other[0].node))),
      ),
  );
}

function findAmbiguousGroup(alternatives: Item[][]): string | undefined {
  for (const alternative of alternatives) {
    for (const item of alternative) {
      if (item.node.kind !== "group") continue;
      if (repeats(item) && ambiguousBody(item.node)) return item.node.source;
      const nested = findAmbiguousGroup(item.node.alternatives);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Returns the offending group, or undefined for a pattern without exponential backtracking. */
export function findExponentialBacktracking(pattern: string): string | undefined {
  try {
    return findAmbiguousGroup(new Parser(pattern).parse());
  } catch {
    return undefined;
  }
}

export function getBacktrackingError(pattern: string): string | null {
  const group = findExponentialBacktracking(pattern);
  return group
    ? `repeats the group "${group}", whose repetitions can split the same text in many ways. Most SDKs then take exponential time on short inputs. Make each repetition start or end with a distinct character`
    : null;
}
