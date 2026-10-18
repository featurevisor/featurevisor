import * as React from "react";

import { VariableValueView } from "./variables";

export function getMutationEntries(value: unknown): Array<[string, unknown]> {
  const entries = (item: unknown): Array<[string, unknown]> =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.entries(item) : [];

  return Array.isArray(value) ? value.flatMap(entries) : entries(value);
}

export function MutationView(props: { value: unknown; nested?: boolean }) {
  const entries = getMutationEntries(props.value);

  if (entries.length === 0) return <VariableValueView value={props.value} nested={props.nested} />;

  return (
    <ol aria-label="Mutations in application order" className="space-y-2">
      {entries.map(([path, value], index) => (
        <li key={index} className="flex min-w-0 gap-2">
          <span className="pt-1 font-mono text-xs text-faint">{index + 1}.</span>
          <div className="min-w-0 flex-1">
            <code className="block text-xs font-semibold [overflow-wrap:anywhere]">{path}</code>
            <div className="mt-1" data-mutation-value="">
              <VariableValueView value={value} nested={props.nested} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
