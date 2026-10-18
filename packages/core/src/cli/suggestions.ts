import type { CLIOptionDefinitions } from "./options";

export function toDashedOptionName(name: string) {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function suggestCLIName(input: string, candidates: string[]): string | undefined {
  if (input.length < 2 || input.length > 64) return undefined;
  const normalize = (value: string) => value.toLowerCase().replace(/-/g, "");
  const normalized = normalize(input);
  const limit = normalized.length < 5 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = limit + 1;
  let tied = false;
  for (const candidate of [...new Set(candidates)].slice(0, 256)) {
    if (candidate.length > 64) continue;
    const other = normalize(candidate);
    if (Math.abs(normalized.length - other.length) > limit) continue;
    const score = distance(normalized, other);
    if (score < bestDistance) {
      best = candidate;
      bestDistance = score;
      tied = false;
    } else if (score === bestDistance) {
      tied = true;
    }
  }
  return bestDistance <= limit && !tied ? best : undefined;
}

export function suggestUnknownOptions(message: string, options: CLIOptionDefinitions): string {
  const match = message.match(/^Unknown arguments?: (.+)$/);
  if (!match) return message;
  const candidates = Object.entries(options).flatMap(([name, definition]) =>
    definition.hidden ? [] : [toDashedOptionName(name), ...[definition.alias || []].flat()],
  );
  const hints = match[1]
    .split(", ")
    .slice(0, 3)
    .flatMap((unknown) => {
      const suggestion = suggestCLIName(unknown, candidates);
      return suggestion ? [`Did you mean "--${suggestion}"?`] : [];
    });
  return hints.length ? `${message}. ${[...new Set(hints)].join(" ")}` : message;
}
