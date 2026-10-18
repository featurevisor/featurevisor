import type {
  ComposeReference,
  ParsedFeature,
  ParsedVariable,
  ParsedVariableOverride,
  Conditions,
  Schema,
} from "@featurevisor/types";
import { compileVariableMutation } from "../builder/variableOverrideProgram";
import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import { isComposedVariable } from "../datasource/composition";
import { flattenVariableOverrides } from "../datasource/variableOverrides";
import { resolveVariableSchema } from "./featureSchema";

export interface CompositionWarning {
  code: "composition_experiment_override" | "composition_nullable_mutation";
  message: string;
  path: (string | number)[];
}

interface SourceNode {
  members?: Map<string, SourceNode>;
  experiments: Set<string>;
  nullable: boolean;
  reference?: ComposeReference;
}

const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isNullValue = (value: unknown, type?: string) =>
  value == null || (type === "json" && typeof value === "string" && value.trim() === "null");

/** A successful nonnull value or present descendant proves the source is nonnull. */
function guardsSource(required: Conditions | undefined, reference: ComposeReference): boolean {
  if (!required || typeof required === "string" || reference.variable === undefined) return false;
  if (Array.isArray(required)) return required.some((item) => guardsSource(item, reference));
  if ("and" in required) return guardsSource(required.and, reference);
  if ("or" in required)
    return required.or.length > 0 && required.or.every((item) => guardsSource(item, reference));
  if ("not" in required) {
    const leaf = required.not.length === 1 ? required.not[0] : undefined;
    return !!(
      leaf &&
      typeof leaf === "object" &&
      "variable" in leaf &&
      leaf.variable === reference.variable &&
      leaf.feature === reference.feature &&
      leaf.operator === "isNull" &&
      (leaf.path === undefined || (Array.isArray(leaf.path) && leaf.path.length === 0))
    );
  }
  return (
    "variable" in required &&
    required.variable === reference.variable &&
    required.feature === reference.feature &&
    (required.operator === "notNull" ||
      (required.operator === "exists" &&
        required.path !== undefined &&
        !(Array.isArray(required.path) && required.path.length === 0)))
  );
}

/** Advisory analysis of valid definitions. No SDK checks or inferred nonnull promises. */
export function createCompositionWarningInspector(
  features: Record<string, ParsedFeature>,
  variables: Record<string, ParsedVariable>,
  schemas: Record<string, Schema>,
) {
  const nodes = new Map<ParsedVariable, SourceNode>();
  function build(variable: ParsedVariable): SourceNode {
    const cached = nodes.get(variable);
    if (cached) return cached;
    if (typeof variable.compose === "string") {
      const aliases: ParsedVariable[] = [];
      let current: ParsedVariable | undefined = variable;
      while (current && typeof current.compose === "string" && !nodes.has(current)) {
        aliases.push(current);
        nodes.set(current, { experiments: new Set(), nullable: false });
        current = owns(variables, current.compose) ? variables[current.compose] : undefined;
      }
      let source = current ? build(current) : { experiments: new Set<string>(), nullable: true };
      for (const alias of aliases.reverse()) {
        const node = nodes.get(alias)!;
        Object.assign(node, source);
        node.reference = { variable: alias.compose as string };
        node.nullable ||=
          !!alias.conditions && alias.conditions !== "*" && isNullValue(alias.disabledValue);
        node.nullable ||= flattenVariableOverrides(alias.overrides).some(
          (override) => override.mutate === undefined && override.value === null,
        );
        source = node;
      }
      return nodes.get(variable)!;
    }
    const node: SourceNode = { experiments: new Set(), nullable: false };
    nodes.set(variable, node);
    if (!isComposedVariable(variable)) {
      const type = resolveVariableSchema(variable, schemas)?.type;
      const isNull = (value: unknown) => isNullValue(value, type);
      node.nullable =
        isNull(variable.defaultValue) ||
        (!!variable.conditions &&
          variable.conditions !== "*" &&
          isNull(
            variable.useDefaultWhenDisabled ? variable.defaultValue : variable.disabledValue,
          )) ||
        flattenVariableOverrides(variable.overrides).some(
          (override) => override.mutate === undefined && isNull(override.value),
        );
      return node;
    }
    node.nullable =
      !!variable.conditions && variable.conditions !== "*" && isNullValue(variable.disabledValue);
    node.members = new Map();
    for (const [alias, reference] of Object.entries(variable.compose)) {
      let source: SourceNode;
      if (reference.feature !== undefined) {
        const feature = owns(features, reference.feature) ? features[reference.feature] : undefined;
        const experiment =
          !!feature?.variations?.length &&
          (reference.variation || reference.variable !== undefined);
        const schema =
          reference.variable !== undefined &&
          feature?.variablesSchema &&
          owns(feature.variablesSchema, reference.variable)
            ? feature.variablesSchema[reference.variable]
            : undefined;
        const type = schema && resolveVariableSchema(schema, schemas)?.type;
        const isNull = (value: unknown) => isNullValue(value, type);
        const providers =
          type === "json" && feature
            ? [
                ...(feature.variations || []),
                ...(Array.isArray(feature.rules)
                  ? feature.rules
                  : Object.values(feature.rules || {}).flat()),
                ...(Array.isArray(feature.force)
                  ? feature.force
                  : Object.values(feature.force || {}).flat()),
              ]
            : [];
        const nullableAssignment = providers.some((provider) => {
          const key = reference.variable!;
          if (
            provider.variables &&
            owns(provider.variables, key) &&
            isNull(provider.variables[key])
          )
            return true;
          return (
            "variableOverrides" in provider &&
            (provider.variableOverrides?.[key] || []).some(
              (override) => override.mutate === undefined && isNull(override.value),
            )
          );
        });
        source = {
          reference,
          experiments: new Set(experiment ? [reference.feature] : []),
          nullable:
            reference.variable !== undefined
              ? !schema ||
                isNull(schema.defaultValue) ||
                nullableAssignment ||
                isNull(schema.useDefaultWhenDisabled ? schema.defaultValue : schema.disabledValue)
              : reference.variation === true && feature?.disabledVariationValue === undefined,
        };
      } else {
        const definition = owns(variables, reference.variable)
          ? variables[reference.variable]
          : undefined;
        source = definition
          ? { ...build(definition), reference }
          : { reference, experiments: new Set(), nullable: true };
      }
      node.members.set(alias, source);
      for (const experiment of source.experiments) node.experiments.add(experiment);
    }
    return node;
  }

  return (variable: ParsedVariable): CompositionWarning[] => {
    if (!isComposedVariable(variable) || !variable.overrides) return [];
    // Own overrides run only after this gate succeeds. A source alias's gate
    // still contributes nullability when another composition reads that alias.
    const root = build(
      typeof variable.compose === "string" && variable.conditions
        ? { ...variable, conditions: undefined }
        : variable,
    );
    const warnings: CompositionWarning[] = [];
    const groups = Array.isArray(variable.overrides)
      ? [[undefined, variable.overrides] as const]
      : Object.entries(variable.overrides);
    const inspect = (
      overrides: ParsedVariableOverride[],
      parent: (string | number)[],
      inheritedGuards: Array<Conditions | undefined>,
    ) =>
      overrides.forEach((override, index) => {
        const base = [...parent, index];
        const guards = [...inheritedGuards, override.conditions];
        const entries =
          override.mutate === undefined
            ? [{ path: [], op: "set", authoredPath: [...base, "value"] }]
            : mutationEntries(override.mutate).map(([key, value], entryIndex) => ({
                ...compileVariableMutation(key, value),
                authoredPath: [
                  ...base,
                  "mutate",
                  ...mutationEntryPath(override.mutate!, entryIndex, key),
                ],
              }));
        for (const operation of entries) {
          let target = root;
          let nullable = false;
          const inspectNull = () => {
            if (
              target.nullable &&
              target.reference &&
              !guards.some((required) => guardsSource(required, target.reference!))
            )
              nullable = true;
          };
          for (const part of operation.path) {
            inspectNull();
            if (!target.members) break;
            const member = typeof part === "string" ? target.members.get(part) : undefined;
            if (!member) break;
            target = member;
          }
          // Append operations create a null final object property as an array.
          // Root array operations and removeValue skip null instead.
          if (
            operation.op === "removeValue" ||
            (operation.path.length === 0 && operation.op !== "set")
          )
            inspectNull();
          if (target.experiments.size)
            warnings.push({
              code: "composition_experiment_override",
              path: operation.authoredPath,
              message: `This override may change values from experiment ${[...target.experiments]
                .sort()
                .map((key) => JSON.stringify(key))
                .join(
                  ", ",
                )}. Source assignment and exposure callbacks run before composed overrides. Change audience behaviour on the source experiment to keep assignment and displayed values aligned.`,
            });
          if (nullable)
            warnings.push({
              code: "composition_nullable_mutation",
              path: operation.authoredPath,
              message:
                "This mutation traverses a composition source that can evaluate to null under its definition. Missing paths are skipped, even when the override matches. Supply a source fallback, replace the member, or require a nonnull source or a present descendant.",
            });
        }
        inspect(override.overrides || [], [...base, "overrides"], guards);
      });
    for (const [environment, overrides] of groups)
      inspect(overrides, environment === undefined ? ["overrides"] : ["overrides", environment], [
        variable.conditions,
      ]);
    return warnings;
  };
}
