import * as React from "react";
import { Link } from "react-router-dom";

import { getEntityRoute } from "../entityTypes";
import { Badge, EntityKey, OverviewChip, OverviewMetaPanel, OverviewMetaRow } from "./ui";

export type SchemaLike = Record<string, unknown>;

type FlatSchemaRow = {
  path: string;
  typeLabel: string;
  isRef: boolean;
  required: boolean;
  description?: string;
  constraints: string[];
};

export function slugifyFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSchemaRef(schema: SchemaLike): schema is SchemaLike & { schema: string } {
  return typeof schema.schema === "string";
}

export function hasSchemaStructure(schema: SchemaLike) {
  const schemaRef = isSchemaRef(schema);
  const type = typeof schema.type === "string" ? schema.type : undefined;

  return (
    !schemaRef &&
    (type === "object" ||
      type === "array" ||
      (Array.isArray(schema.oneOf) && schema.oneOf.length > 0))
  );
}

export function usesSchemaStructureTable(schema: SchemaLike) {
  const type = typeof schema.type === "string" ? schema.type : undefined;

  return type === "object" || type === "array";
}

export function hasSchemaTableRows(schema: SchemaLike) {
  const rows = flattenSchemaRows(schema, "");

  // A lone root row for a primitive only repeats the type and description,
  // so show a table only when it adds structure or constraints.
  if (rows.length === 1 && rows[0].path === "—" && !rows[0].isRef) {
    return rows[0].constraints.length > 0;
  }

  return rows.length > 0;
}

function getSchemaDescription(schema: SchemaLike) {
  const description = schema.description;

  return typeof description === "string" && description.trim().length > 0
    ? description.trim()
    : undefined;
}

function formatConstraintValue(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function getSchemaConstraintLines(schema: SchemaLike) {
  const lines: string[] = [];

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    lines.push(`enum: ${schema.enum.map(formatConstraintValue).join(", ")}`);
  }

  if ("const" in schema && schema.const !== undefined) {
    lines.push(`const: ${formatConstraintValue(schema.const)}`);
  }

  if (typeof schema.minimum === "number") {
    lines.push(`minimum: ${schema.minimum}`);
  }

  if (typeof schema.maximum === "number") {
    lines.push(`maximum: ${schema.maximum}`);
  }

  if (typeof schema.minLength === "number") {
    lines.push(`minLength: ${schema.minLength}`);
  }

  if (typeof schema.maxLength === "number") {
    lines.push(`maxLength: ${schema.maxLength}`);
  }

  if (typeof schema.pattern === "string") {
    lines.push(`pattern: ${schema.pattern}`);
  }

  if (typeof schema.format === "string") {
    lines.push(`format: ${schema.format}`);
  }

  if (typeof schema.minItems === "number") {
    lines.push(`minItems: ${schema.minItems}`);
  }

  if (typeof schema.maxItems === "number") {
    lines.push(`maxItems: ${schema.maxItems}`);
  }

  if (schema.uniqueItems === true) {
    lines.push("uniqueItems: true");
  }

  return lines;
}

function getArrayElementConstraintLines(schema: SchemaLike, items: SchemaLike) {
  return [...getSchemaConstraintLines(schema), ...getSchemaConstraintLines(items)];
}

function createSchemaRow(
  schema: SchemaLike,
  path: string,
  required: boolean,
  typeLabel?: string,
): FlatSchemaRow {
  const schemaRef = isSchemaRef(schema);

  return {
    path,
    typeLabel: typeLabel ?? (schemaRef ? schema.schema : getLeafTypeLabel(schema)),
    isRef: schemaRef,
    required,
    description: getSchemaDescription(schema),
    constraints: getSchemaConstraintLines(schema),
  };
}

function appendAdditionalPropertyRows(schema: SchemaLike, prefix: string, rows: FlatSchemaRow[]) {
  const additionalProperties = schema.additionalProperties;

  if (additionalProperties === false) {
    rows.push({
      path: prefix ? `${prefix}.*` : "*",
      typeLabel: "—",
      isRef: false,
      required: false,
      description: undefined,
      constraints: ["additionalProperties: false"],
    });
    return rows;
  }

  if (!additionalProperties || typeof additionalProperties !== "object") {
    return rows;
  }

  const propertyPath = prefix ? `${prefix}.*` : "*";
  const propertySchema = additionalProperties as SchemaLike;

  if (
    propertySchema.type === "object" &&
    propertySchema.properties &&
    typeof propertySchema.properties === "object"
  ) {
    rows.push(...flattenSchemaRows(propertySchema, propertyPath, false));
    return rows;
  }

  rows.push(createSchemaRow(propertySchema, propertyPath, false));
  return rows;
}

/** Types read as code, matching the type chips on the variables list. */
function TypeBadge(props: { children: React.ReactNode }) {
  return (
    <code className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] leading-none text-slate-700">
      {props.children}
    </code>
  );
}

function SchemaRefLink(props: { name: string; setKey?: string }) {
  return (
    <Link
      to={getEntityRoute("schema", props.name, props.setKey)}
      title={`Schema ${props.name}`}
      className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] leading-none text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100"
    >
      {props.name}
    </Link>
  );
}

export function VariablePermalink(props: { targetId: string; label?: string }) {
  return (
    <a
      href={`#${props.targetId}`}
      aria-label={props.label || "Link to this variable"}
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

function flattenSchemaRows(schema: SchemaLike, prefix: string, required = false): FlatSchemaRow[] {
  if (isSchemaRef(schema)) {
    return [createSchemaRow(schema, prefix || "—", required)];
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return (schema.oneOf as SchemaLike[]).flatMap((option, index) => {
      const optionPrefix = prefix ? `${prefix} (${index + 1})` : `${index + 1}`;

      return flattenSchemaRows(option, optionPrefix, required);
    });
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;

  if (type === "object") {
    const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, SchemaLike>)
        : {};
    const rows = Object.entries(properties).flatMap(([key, propertySchema]) =>
      flattenSchemaRows(propertySchema, prefix ? `${prefix}.${key}` : key, requiredKeys.has(key)),
    );

    return appendAdditionalPropertyRows(schema, prefix, rows);
  }

  if (type === "array") {
    if (schema.items && typeof schema.items === "object") {
      const items = schema.items as SchemaLike;
      const itemType = getLeafTypeLabel(items);
      const arrayPath = prefix ? `${prefix}[]` : "[]";

      if (isSchemaRef(items) || (items.type && items.type !== "object")) {
        const row = createSchemaRow(
          schema,
          arrayPath,
          required,
          isSchemaRef(items) ? itemType : `${itemType}[]`,
        );
        row.isRef = isSchemaRef(items);
        row.description = getSchemaDescription(schema) || getSchemaDescription(items);
        row.constraints = getArrayElementConstraintLines(schema, items);

        return [row];
      }

      if (items.type === "object" && items.properties && typeof items.properties === "object") {
        const requiredKeys = new Set(
          Array.isArray(items.required) ? items.required.map(String) : [],
        );
        const properties = items.properties as Record<string, SchemaLike>;
        const rows = Object.entries(properties).flatMap(([key, propertySchema]) =>
          flattenSchemaRows(
            propertySchema,
            prefix ? `${prefix}[].${key}` : `[].${key}`,
            requiredKeys.has(key),
          ),
        );

        if (getSchemaConstraintLines(schema).length > 0) {
          rows.unshift({
            path: arrayPath,
            typeLabel: "object[]",
            isRef: false,
            required,
            description: getSchemaDescription(schema),
            constraints: getSchemaConstraintLines(schema),
          });
        }

        return appendAdditionalPropertyRows(items, prefix ? `${prefix}[]` : "[]", rows);
      }
    }

    return [createSchemaRow(schema, prefix || "—", required)];
  }

  if (type) {
    return [createSchemaRow(schema, prefix || "—", required)];
  }

  return [];
}

export function SchemaTable(props: { schema: SchemaLike; setKey?: string }) {
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
          <col className="variable-schema-col-constraints" />
          <col className="variable-schema-col-description" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
            <th className="pb-1.5 pr-3 font-semibold">Path</th>
            <th className="pb-1.5 pr-3 font-semibold">Type</th>
            <th className="pb-1.5 pr-3 font-semibold">Constraints</th>
            <th className="pb-1.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.path}-${index}`} className="border-b border-border/60 align-top">
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
                  <span className="inline-flex items-center gap-1">
                    <SchemaRefLink name={row.typeLabel} setKey={props.setKey} />
                    {row.path.endsWith("[]") && <TypeBadge>[]</TypeBadge>}
                  </span>
                ) : (
                  <TypeBadge>{row.typeLabel}</TypeBadge>
                )}
              </td>
              <td className="py-1.5 pr-3 font-mono text-[11px] text-muted [overflow-wrap:anywhere]">
                {row.constraints.length > 0 ? (
                  <ul className="space-y-0.5">
                    {row.constraints.map((constraint) => (
                      <li key={constraint}>{constraint}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-faint">—</span>
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

type SchemaProperty = {
  label: string;
  value: React.ReactNode;
};

function SchemaPropertyValue(props: { children: React.ReactNode }) {
  return <OverviewChip className="font-mono">{props.children}</OverviewChip>;
}

function getSchemaProperties(
  schema: SchemaLike,
  setKey?: string,
  options: { includeType?: boolean } = {},
): SchemaProperty[] {
  const properties: SchemaProperty[] = [];

  if (isSchemaRef(schema)) {
    properties.push({
      label: "Schema",
      value: <SchemaRefLink name={schema.schema} setKey={setKey} />,
    });
    return properties;
  }

  if (options.includeType && typeof schema.type === "string") {
    properties.push({
      label: "Type",
      value: <TypeBadge>{schema.type}</TypeBadge>,
    });
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    properties.push({
      label: "Enum",
      value: (
        <span className="flex flex-wrap gap-1.5">
          {schema.enum.map((value, index) => (
            <SchemaPropertyValue key={index}>{formatConstraintValue(value)}</SchemaPropertyValue>
          ))}
        </span>
      ),
    });
  }

  if ("const" in schema && schema.const !== undefined) {
    properties.push({
      label: "Const",
      value: <SchemaPropertyValue>{formatConstraintValue(schema.const)}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.minimum === "number") {
    properties.push({
      label: "Minimum",
      value: <SchemaPropertyValue>{schema.minimum}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.maximum === "number") {
    properties.push({
      label: "Maximum",
      value: <SchemaPropertyValue>{schema.maximum}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.minLength === "number") {
    properties.push({
      label: "Min length",
      value: <SchemaPropertyValue>{schema.minLength}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.maxLength === "number") {
    properties.push({
      label: "Max length",
      value: <SchemaPropertyValue>{schema.maxLength}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.pattern === "string") {
    properties.push({
      label: "Pattern",
      value: <SchemaPropertyValue>{schema.pattern}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.format === "string") {
    properties.push({
      label: "Format",
      value: <SchemaPropertyValue>{schema.format}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.minItems === "number") {
    properties.push({
      label: "Min items",
      value: <SchemaPropertyValue>{schema.minItems}</SchemaPropertyValue>,
    });
  }

  if (typeof schema.maxItems === "number") {
    properties.push({
      label: "Max items",
      value: <SchemaPropertyValue>{schema.maxItems}</SchemaPropertyValue>,
    });
  }

  if (schema.uniqueItems === true) {
    properties.push({
      label: "Unique items",
      value: <SchemaPropertyValue>true</SchemaPropertyValue>,
    });
  }

  return properties;
}

function hasSchemaProperties(schema: SchemaLike) {
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return true;
  }

  return getSchemaProperties(schema).length > 0;
}

function SchemaPropertiesPanel(props: {
  schema: SchemaLike;
  setKey?: string;
  includeType?: boolean;
}) {
  const properties = getSchemaProperties(props.schema, props.setKey, {
    includeType: props.includeType,
  });

  if (properties.length === 0) {
    return null;
  }

  return (
    <OverviewMetaPanel>
      {properties.map((property) => (
        <OverviewMetaRow key={property.label} label={property.label}>
          {property.value}
        </OverviewMetaRow>
      ))}
    </OverviewMetaPanel>
  );
}

export function SchemaPropertiesOverview(props: { schema: SchemaLike; setKey?: string }) {
  const schema = props.schema;

  if (!hasSchemaProperties(schema)) {
    return null;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return (
      <div className="space-y-4">
        {(schema.oneOf as SchemaLike[]).map((option, index) => (
          <section key={index}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Option {index + 1}
            </h3>
            <SchemaPropertiesPanel schema={option} setKey={props.setKey} includeType />
          </section>
        ))}
      </div>
    );
  }

  return <SchemaPropertiesPanel schema={schema} setKey={props.setKey} />;
}

function DefaultValueCodeBlock(props: { children: React.ReactNode; nested?: boolean }) {
  return (
    <pre
      className={[
        "overflow-x-auto font-mono text-xs leading-relaxed text-text [overflow-wrap:anywhere] whitespace-pre-wrap",
        props.nested
          ? "rounded bg-elevated/70 px-2.5 py-2"
          : "rounded-md border border-border bg-elevated p-3",
      ].join(" ")}
    >
      <code>{props.children}</code>
    </pre>
  );
}

export function VariableValueView(props: { value: unknown; nested?: boolean }) {
  const value = props.value;

  if (value === undefined || value === null) {
    return <span className="text-muted">none</span>;
  }

  if (value === "") {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
          ""
        </code>
        <span className="text-xs text-muted">empty string</span>
      </span>
    );
  }

  if (typeof value === "string") {
    return <DefaultValueCodeBlock nested={props.nested}>{value}</DefaultValueCodeBlock>;
  }

  if (typeof value === "object") {
    return (
      <DefaultValueCodeBlock nested={props.nested}>
        {JSON.stringify(value, null, 2)}
      </DefaultValueCodeBlock>
    );
  }

  return <span className="font-mono text-sm text-text">{String(value)}</span>;
}

export function isInlineVariableValue(value: unknown) {
  return typeof value === "number" || typeof value === "boolean" || value === "";
}

/** A place in the feature that sets a variable, linked to that place. */
export interface VariableSetter {
  label: string;
  to: string;
}

function VariableDefinition(props: {
  name: string;
  schema: SchemaLike;
  setKey?: string;
  setBy?: VariableSetter[];
  /** Entities whose conditions or compositions read this variable. */
  readBy?: React.ReactNode;
}) {
  const schema = props.schema;
  const variableId = slugifyFragment(props.name);
  const schemaRef = isSchemaRef(schema);
  const type = typeof schema.type === "string" ? schema.type : undefined;
  const showStructure = hasSchemaTableRows(schema);
  const description = getSchemaDescription(schema);
  const defaultValue = "defaultValue" in schema ? schema.defaultValue : undefined;
  const inlineDefault = isInlineVariableValue(defaultValue);

  return (
    <section
      id={variableId}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <header className="group flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-elevated px-4 py-2.5">
        <h2 className="min-w-0 font-mono font-semibold text-text">
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
        {schema.deprecated === true && <Badge tone="warning">deprecated</Badge>}
        <VariablePermalink targetId={variableId} />
      </header>

      <div className="divide-y divide-border">
        {description && <p className="px-4 py-3 text-sm text-muted">{description}</p>}

        {showStructure && (
          <div className="px-4 py-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Structure
            </h3>
            <SchemaTable schema={schema} setKey={props.setKey} />
          </div>
        )}

        {"defaultValue" in schema &&
          (inlineDefault ? (
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                Default
              </span>
              <VariableValueView value={defaultValue} />
            </div>
          ) : (
            <div className="px-4 py-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                Default
              </h3>
              <VariableValueView value={defaultValue} />
            </div>
          ))}

        {props.setBy && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-sm">
            <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Set by
            </span>
            {props.setBy.length ? (
              props.setBy.map((setter) => (
                <Link
                  key={`${setter.label}:${setter.to}`}
                  to={setter.to}
                  className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text hover:border-slate-400 hover:bg-elevated"
                >
                  {setter.label}
                </Link>
              ))
            ) : (
              <span className="text-xs text-muted">
                No variation, rule or force entry changes it, so it is always the default.
              </span>
            )}
          </div>
        )}

        {props.readBy && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-sm">
            <span
              className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint"
              title="Their conditions or compositions read this variable, so changing its type or values changes them."
            >
              Read by
            </span>
            {props.readBy}
          </div>
        )}
      </div>
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
  /** Where each variable is set, by variable name. */
  setBy?: Record<string, VariableSetter[]>;
  /** Who reads each variable, by variable name. */
  readBy?: Map<string, React.ReactNode>;
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
          setBy={props.setBy ? props.setBy[name] || [] : undefined}
          readBy={props.readBy?.get(name)}
        />
      ))}
    </div>
  );
}
