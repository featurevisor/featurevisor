import * as React from "react";
import { Link } from "react-router-dom";

import { getEntityRoute } from "../entityTypes";
import { Badge, EntityKey } from "./ui";

type SchemaLike = Record<string, unknown>;

type FlatSchemaRow = {
  path: string;
  typeLabel: string;
  isRef: boolean;
  required: boolean;
  description?: string;
};

function slugifyFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSchemaRef(schema: SchemaLike) {
  return typeof schema.schema === "string";
}

function getSchemaDescription(schema: SchemaLike) {
  const description = schema.description;

  return typeof description === "string" && description.trim().length > 0
    ? description.trim()
    : undefined;
}

function TypeBadge(props: { children: React.ReactNode }) {
  return <Badge tone="primary">{props.children}</Badge>;
}

function SchemaRefLink(props: { name: string; setKey?: string }) {
  return (
    <Link
      to={getEntityRoute("schema", props.name, props.setKey)}
      className="inline-flex hover:opacity-80"
    >
      <Badge tone="primary">{props.name}</Badge>
    </Link>
  );
}

function VariablePermalink(props: { targetId: string }) {
  return (
    <a
      href={`#${props.targetId}`}
      aria-label="Link to this variable"
      className="inline-flex rounded p-1 text-muted opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20" />
      </svg>
    </a>
  );
}

function getLeafTypeLabel(schema: SchemaLike) {
  if (isSchemaRef(schema)) {
    return schema.schema;
  }

  return typeof schema.type === "string" ? schema.type : "unknown";
}

function flattenSchemaRows(
  schema: SchemaLike,
  prefix: string,
  required = false,
): FlatSchemaRow[] {
  if (isSchemaRef(schema)) {
    return [
      {
        path: prefix,
        typeLabel: schema.schema,
        isRef: true,
        required,
        description: getSchemaDescription(schema),
      },
    ];
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return (schema.oneOf as SchemaLike[]).flatMap((option, index) => {
      const optionPrefix = prefix ? `${prefix} (${index + 1})` : `${index + 1}`;

      return flattenSchemaRows(option, optionPrefix, required);
    });
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;

  if (type === "object" && schema.properties && typeof schema.properties === "object") {
    const requiredKeys = new Set(
      Array.isArray(schema.required) ? schema.required.map(String) : [],
    );
    const properties = schema.properties as Record<string, SchemaLike>;

    return Object.entries(properties).flatMap(([key, propertySchema]) =>
      flattenSchemaRows(
        propertySchema,
        prefix ? `${prefix}.${key}` : key,
        requiredKeys.has(key),
      ),
    );
  }

  if (type === "array" && schema.items && typeof schema.items === "object") {
    const items = schema.items as SchemaLike;
    const itemType = getLeafTypeLabel(items);

    if (isSchemaRef(items) || (items.type && items.type !== "object")) {
      return [
        {
          path: prefix ? `${prefix}[]` : "[]",
          typeLabel: `${itemType}[]`,
          isRef: isSchemaRef(items),
          required,
          description: getSchemaDescription(schema) || getSchemaDescription(items),
        },
      ];
    }

    if (items.type === "object" && items.properties && typeof items.properties === "object") {
      const requiredKeys = new Set(
        Array.isArray(items.required) ? items.required.map(String) : [],
      );
      const properties = items.properties as Record<string, SchemaLike>;

      return Object.entries(properties).flatMap(([key, propertySchema]) =>
        flattenSchemaRows(
          propertySchema,
          prefix ? `${prefix}[].${key}` : `[].${key}`,
          requiredKeys.has(key),
        ),
      );
    }
  }

  if (type && prefix) {
    return [
      {
        path: prefix,
        typeLabel: type,
        isRef: false,
        required,
        description: getSchemaDescription(schema),
      },
    ];
  }

  return [];
}

function SchemaTable(props: { schema: SchemaLike; setKey?: string }) {
  const rows = flattenSchemaRows(props.schema, "");

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="variable-schema-table w-full table-fixed text-xs leading-snug">
        <colgroup>
          <col className="variable-schema-col-path" />
          <col className="variable-schema-col-type" />
          <col className="variable-schema-col-description" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-faint">
            <th className="pb-1.5 pr-3 font-semibold">Path</th>
            <th className="pb-1.5 pr-3 font-semibold">Type</th>
            <th className="pb-1.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b border-border/60 align-top">
              <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">
                <span className="font-mono text-text">{row.path}</span>
                {row.required && (
                  <span className="ml-1.5 text-[9px] font-semibold uppercase text-danger">
                    required
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3">
                {row.isRef ? (
                  <SchemaRefLink name={row.typeLabel} setKey={props.setKey} />
                ) : (
                  <TypeBadge>{row.typeLabel}</TypeBadge>
                )}
              </td>
              <td className="py-1.5 text-muted [overflow-wrap:anywhere]">
                {row.description || <span className="text-faint">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DefaultValueCodeBlock(props: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-elevated p-3 font-mono text-xs leading-relaxed text-text [overflow-wrap:anywhere] whitespace-pre-wrap">
      <code>{props.children}</code>
    </pre>
  );
}

export function VariableValueView(props: { value: unknown }) {
  const value = props.value;

  if (value === undefined || value === null) {
    return <span className="text-muted">none</span>;
  }

  if (typeof value === "string") {
    return <DefaultValueCodeBlock>{value}</DefaultValueCodeBlock>;
  }

  if (typeof value === "object") {
    return <DefaultValueCodeBlock>{JSON.stringify(value, null, 2)}</DefaultValueCodeBlock>;
  }

  return <span className="font-mono text-sm text-text">{String(value)}</span>;
}

export function isInlineVariableValue(value: unknown) {
  return typeof value === "number" || typeof value === "boolean";
}

function VariableDefinition(props: {
  name: string;
  schema: SchemaLike;
  setKey?: string;
}) {
  const schema = props.schema;
  const variableId = slugifyFragment(props.name);
  const schemaRef = isSchemaRef(schema);
  const type = typeof schema.type === "string" ? schema.type : undefined;
  const hasStructure =
    !schemaRef &&
    (type === "object" || type === "array" || (Array.isArray(schema.oneOf) && schema.oneOf.length > 0));
  const description = getSchemaDescription(schema);
  const defaultValue = "defaultValue" in schema ? schema.defaultValue : undefined;
  const inlineDefault = isInlineVariableValue(defaultValue);

  return (
    <section
      id={variableId}
      className="scroll-mt-6 rounded-lg border border-border bg-elevated/60 p-4 ring-1 ring-black/5"
    >
      <div className="group flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 font-mono text-base font-semibold text-text">
          <a
            href={`#${variableId}`}
            className="text-text no-underline hover:text-primary [overflow-wrap:anywhere]"
          >
            <EntityKey value={props.name} className="font-semibold" />
          </a>
        </h2>
        {schemaRef ? (
          <SchemaRefLink name={String(schema.schema)} setKey={props.setKey} />
        ) : type ? (
          <TypeBadge>{type}</TypeBadge>
        ) : null}
        <VariablePermalink targetId={variableId} />
        {schema.deprecated === true && <Badge tone="warning">deprecated</Badge>}
      </div>

      {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}

      {hasStructure && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Structure
          </h3>
          <SchemaTable schema={schema} setKey={props.setKey} />
        </div>
      )}

      {"defaultValue" in schema &&
        (inlineDefault ? (
          <p className="mt-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">Default </span>
            <VariableValueView value={defaultValue} />
          </p>
        ) : (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Default</h3>
            <VariableValueView value={defaultValue} />
          </div>
        ))}
    </section>
  );
}

function useScrollToHash(dependencies: React.DependencyList) {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const targetId = decodeURIComponent(window.location.hash.slice(1));

    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const targetElement = document.getElementById(targetId);

      if (!targetElement) {
        return;
      }

      targetElement.scrollIntoView({ block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, dependencies);
}

export function FeatureVariablesList(props: {
  variablesSchema: Record<string, unknown>;
  setKey?: string;
}) {
  const entries = Object.entries(props.variablesSchema).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  useScrollToHash([entries.length]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {entries.map(([name, schema]) => (
        <VariableDefinition
          key={name}
          name={name}
          schema={(schema || {}) as SchemaLike}
          setKey={props.setKey}
        />
      ))}
    </div>
  );
}
