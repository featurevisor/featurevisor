import type { Schema } from "@featurevisor/types";

import { valueMatchesSchema } from "./featureSchema";

type Node = Record<string, unknown>;
type Path = (string | number)[];

export interface AnnotationFinding {
  path: Path;
  message: string;
}

export interface AnnotationFindings {
  errors: AnnotationFinding[];
  /** Choices of one field where some have a `title` and others do not, `option_without_title`. */
  warnings: AnnotationFinding[];
}

/** Annotations Featurevisor uses itself, which no vocabulary can declare. */
const FIELD_BUILT_INS = ["title", "examples", "order", "options"];
/** What every choice can carry, `title`, and the name `options` gives the choice's own value. */
const OPTION_BUILT_INS = ["title", "value"];

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** The node a `schema` reference leads to, through any chain of them. */
function resolve(node: unknown, schemas: Record<string, Schema>, seen = new Set<string>()) {
  if (!isNode(node)) return undefined;
  if (typeof node.schema === "string") {
    if (seen.has(node.schema)) return undefined;
    seen.add(node.schema);
    return resolve(schemas[node.schema], schemas, seen);
  }
  return node;
}

/** Whether a node is a `oneOf` whose every branch is a `const`, a list of choices like an `enum`. */
export function isChoiceList(node: unknown, schemas: Record<string, Schema>): boolean {
  return (
    isNode(node) &&
    Array.isArray(node.oneOf) &&
    node.oneOf.length > 0 &&
    node.oneOf.every((branch) => {
      const resolved = resolve(branch, schemas);
      return Boolean(resolved && "const" in resolved);
    })
  );
}

/** How a choice's value is written as a key of `options`: itself for text, its JSON text otherwise. */
function optionKey(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Checks a schema file's annotations against its vocabularies and the built in
 * annotations: `annotationsSchema` for fields and objects, `optionSchema` for
 * choices, `examples` against the field's own rules, `order` against its
 * fields, and the keys of `options` against its `enum`. It warns when some of
 * a field's choices have a `title` and others do not. Referenced schemas are
 * checked in their own files, with their own vocabularies.
 */
export function getSchemaAnnotationFindings(
  root: unknown,
  schemas: Record<string, Schema>,
): AnnotationFindings {
  const errors: AnnotationFinding[] = [];
  const warnings: AnnotationFinding[] = [];
  if (!isNode(root)) return { errors, warnings };

  const vocabulary = (field: "annotationsSchema" | "optionSchema", reserved: string[]) => {
    const given = root[field];
    if (given === undefined) return undefined;
    const resolved = resolve(given, schemas);
    if (!resolved || resolved.type !== "object") {
      errors.push({
        path: [field],
        message: `\`${field}\` must be an object schema, whose properties are the names ${field === "annotationsSchema" ? "annotations" : "a choice"} can have.`,
      });
      return undefined;
    }
    const properties = isNode(resolved.properties) ? resolved.properties : {};
    for (const name of reserved) {
      if (!hasOwn(properties, name)) continue;
      errors.push({
        // A vocabulary written inline is reported where the name is, and a referenced one at the reference.
        path: isNode(given) && given.schema === undefined ? [field, "properties", name] : [field],
        message:
          name === "value"
            ? "`value` holds each choice's own value, so `optionSchema` cannot declare it."
            : `\`${name}\` is built in, so \`${field}\` cannot declare it.`,
      });
    }
    return resolved;
  };
  const fieldVocabulary = vocabulary("annotationsSchema", FIELD_BUILT_INS);
  const optionVocabulary = vocabulary("optionSchema", OPTION_BUILT_INS);

  /** One name a vocabulary declares, checked against its rules. */
  const checkNamed = (
    vocab: Node | undefined,
    field: "annotationsSchema" | "optionSchema",
    name: string,
    value: unknown,
    path: Path,
  ) => {
    const what = field === "annotationsSchema" ? "annotation" : "choice field";
    if (!vocab) {
      errors.push({
        path,
        message: `\`${name}\` is not a built in ${what}, and this schema has no \`${field}\` to declare it.`,
      });
      return;
    }
    const properties = isNode(vocab.properties) ? vocab.properties : {};
    const rule = hasOwn(properties, name) ? properties[name] : vocab.additionalProperties;
    if (rule === undefined) {
      const known = Object.keys(properties);
      errors.push({
        path,
        message: `Unknown ${what} \`${name}\`. \`${field}\` declares ${known.length > 0 ? known.map((key) => `\`${key}\``).join(", ") : "none"}.`,
      });
      return;
    }
    if (rule !== true && !valueMatchesSchema(rule as Node, value, schemas)) {
      errors.push({
        path,
        message: `\`${name}\` does not match what \`${field}\` declares for it.`,
      });
    }
  };

  const checkTitle = (value: unknown, path: Path) => {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push({ path, message: "`title` must be text." });
    }
  };

  /** A choice's own annotations: its `title` and what `optionSchema` declares. */
  const checkChoice = (entry: Node, path: Path) => {
    for (const [name, value] of Object.entries(entry)) {
      if (name === "title") checkTitle(value, [...path, name]);
      else if (name === "value") {
        errors.push({
          path: [...path, name],
          message: "`value` is the choice's own value, so a choice cannot set it.",
        });
      } else checkNamed(optionVocabulary, "optionSchema", name, value, [...path, name]);
    }
  };

  /** Warns when some choices have a `title` and others do not. */
  const checkTitles = (choices: { value: unknown; entry: unknown }[], path: Path) => {
    const untitled = choices.filter(
      (choice) => !(isNode(choice.entry) && typeof choice.entry.title === "string"),
    );
    if (untitled.length === 0 || untitled.length === choices.length) return;
    warnings.push({
      path,
      message: `Some choices have a \`title\` and ${untitled.map((choice) => show(choice.value)).join(", ")} ${untitled.length === 1 ? "has" : "have"} none, so a list would show titles beside raw values. Give every choice a title, or none.`,
    });
  };

  /** A field's or an object's own annotations. */
  const checkField = (node: Node, annotations: Node, path: Path) => {
    for (const [name, value] of Object.entries(annotations)) {
      const at = [...path, name];
      if (name === "title") checkTitle(value, at);
      else if (name === "examples") {
        if (!Array.isArray(value)) {
          errors.push({ path: at, message: "`examples` must be a list of values." });
          continue;
        }
        value.forEach((example, index) => {
          if (!valueMatchesSchema(node, example, schemas)) {
            errors.push({
              path: [...at, index],
              message: `Example ${show(example)} does not pass the field's own rules.`,
            });
          }
        });
      } else if (name === "order") {
        const object = resolve(node, schemas);
        const properties = object && isNode(object.properties) ? object.properties : undefined;
        if (!properties) {
          errors.push({
            path: at,
            message: "`order` lists an object's fields, and this node has no `properties`.",
          });
          continue;
        }
        if (!Array.isArray(value)) {
          errors.push({ path: at, message: "`order` must be a list of field names." });
          continue;
        }
        const seen = new Set<unknown>();
        value.forEach((field, index) => {
          if (typeof field !== "string" || !hasOwn(properties, field)) {
            errors.push({
              path: [...at, index],
              message: `\`order\` names ${show(field)}, which is not a field here. Fields: ${Object.keys(properties).join(", ")}.`,
            });
          } else if (seen.has(field)) {
            errors.push({ path: [...at, index], message: `\`order\` names ${field} twice.` });
          }
          seen.add(field);
        });
      } else if (name === "options") {
        if (!Array.isArray(node.enum)) {
          errors.push({
            path: at,
            message:
              "`options` goes beside an `enum`, keyed by its values. A `oneOf` of consts gives each choice its annotations in its own branch.",
          });
          continue;
        }
        if (!isNode(value)) {
          errors.push({
            path: at,
            message: "`options` must be a map from each choice's value to what it carries.",
          });
          continue;
        }
        const values = node.enum as unknown[];
        const named = new Map<string, unknown[]>();
        for (const choice of values) {
          const key = optionKey(choice);
          named.set(key, [...(named.get(key) || []), choice]);
        }
        for (const [key, entry] of Object.entries(value)) {
          const choices = named.get(key);
          if (!choices) {
            errors.push({
              path: [...at, key],
              message: `${key} is not one of the \`enum\`'s values: ${values.map(show).join(", ")}.`,
            });
            continue;
          }
          if (choices.length > 1) {
            errors.push({
              path: [...at, key],
              message: `${key} names ${choices.map((choice) => JSON.stringify(choice)).join(" and ")} at once, so it cannot say which.`,
            });
            continue;
          }
          if (!isNode(entry)) {
            errors.push({
              path: [...at, key],
              message: "A choice's entry must be a map, such as `{ title: ... }`.",
            });
            continue;
          }
          checkChoice(entry, [...at, key]);
        }
        checkTitles(
          values.map((choice) => ({
            value: choice,
            entry: hasOwn(value, optionKey(choice)) ? value[optionKey(choice)] : undefined,
          })),
          at,
        );
      } else checkNamed(fieldVocabulary, "annotationsSchema", name, value, at);
    }
  };

  const visit = (node: unknown, path: Path, choice: boolean) => {
    if (!isNode(node)) return;
    if (node.annotations !== undefined) {
      const at = [...path, "annotations"];
      if (!isNode(node.annotations)) {
        errors.push({ path: at, message: "`annotations` must be a map of names to values." });
      } else if (choice) checkChoice(node.annotations, at);
      else checkField(node, node.annotations, at);
    }

    if (isNode(node.properties)) {
      for (const [key, property] of Object.entries(node.properties))
        visit(property, [...path, "properties", key], false);
    }
    if (isNode(node.items)) visit(node.items, [...path, "items"], false);
    if (isNode(node.additionalProperties))
      visit(node.additionalProperties, [...path, "additionalProperties"], false);
    if (Array.isArray(node.oneOf)) {
      // The branches of a list of choices carry what a choice carries, and any other branch a field's annotations.
      const list = isChoiceList(node, schemas);
      if (list) {
        const choices = node.oneOf.map((branch) => ({
          value: resolve(branch, schemas)?.const,
          entry: isNode(branch) ? branch.annotations : undefined,
        }));
        choices.forEach((current, index) => {
          const earlier = choices.findIndex(
            (other) => JSON.stringify(other.value) === JSON.stringify(current.value),
          );
          if (earlier < index) {
            errors.push({
              path: [...path, "oneOf", index],
              message: `${show(current.value)} is a choice already, at \`oneOf[${earlier}]\`.`,
            });
          }
        });
        checkTitles(choices, [...path, "oneOf"]);
      }
      node.oneOf.forEach((branch, index) => visit(branch, [...path, "oneOf", index], list));
    }
  };

  visit(root, [], false);
  return { errors, warnings };
}
