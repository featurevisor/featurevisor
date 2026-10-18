import type {
  VariableMutationOperation,
  VariableMutationPathPart,
  VariableValue,
} from "@featurevisor/types";

type Primitive = string | number | boolean | null;
type MutableValue = Primitive | MutableValue[] | { [key: string]: MutableValue };
type MutableObject = { [key: string]: MutableValue };
type Container = MutableValue[] | MutableObject;
const DANGEROUS_KEYS = ["__proto__", "prototype", "constructor"];

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isObject(value: unknown): value is MutableObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSelector(
  value: unknown,
): value is { select: { property: string; values: Primitive[] } } {
  if (!isObject(value) || !hasOwn(value, "select") || !isObject(value.select)) return false;
  const select = value.select;
  return (
    hasOwn(select, "property") &&
    typeof select.property === "string" &&
    hasOwn(select, "values") &&
    Array.isArray(select.values) &&
    select.values.every(isPrimitive)
  );
}

function validateOperation(operation: unknown): asserts operation is VariableMutationOperation {
  if (!isObject(operation) || !hasOwn(operation, "op") || !hasOwn(operation, "path")) {
    throw new Error("Invalid variable mutation operation");
  }
  const op = operation.op;
  if (
    op !== "set" &&
    op !== "append" &&
    op !== "appendUnique" &&
    op !== "removeValue" &&
    op !== "prepend" &&
    op !== "before" &&
    op !== "after" &&
    op !== "remove"
  ) {
    throw new Error("Invalid variable mutation operation");
  }
  if (op !== "remove" && (!hasOwn(operation, "value") || typeof operation.value === "undefined")) {
    throw new Error("Variable mutation operation requires a value");
  }
  if (
    (op === "appendUnique" || op === "removeValue") &&
    (!isPrimitive(operation.value) ||
      (typeof operation.value === "number" && !Number.isFinite(operation.value)))
  ) {
    throw new Error("Variable mutation operation requires a primitive value");
  }
  if (!Array.isArray(operation.path)) throw new Error("Invalid variable mutation path");
  operation.path.forEach((part) => {
    const key =
      typeof part === "string"
        ? part
        : isSelector(part)
          ? part.select.property
          : isIndex(part)
            ? null
            : undefined;
    if (typeof key === "undefined") throw new Error("Invalid variable mutation path");
    if (key !== null && DANGEROUS_KEYS.indexOf(key) !== -1)
      throw new Error("Unsafe variable mutation key");
  });
}

function findSelectedIndex(
  value: MutableValue[],
  selector: { property: string; values: Primitive[] },
): number {
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (isObject(candidate) && hasOwn(candidate, selector.property)) {
      const propertyValue = candidate[selector.property];
      if (isPrimitive(propertyValue) && selector.values.indexOf(propertyValue) !== -1) return index;
    }
  }
  return -1;
}

function pathKey(container: MutableValue, part: VariableMutationPathPart): string | number {
  if (typeof part === "string") {
    if (!isObject(container)) throw new Error("Variable mutation expected an object");
    return part;
  }
  if (!Array.isArray(container)) throw new Error("Variable mutation expected an array");
  return isIndex(part) ? part : findSelectedIndex(container, part.select);
}

export function copyVariableObject(value: MutableObject): MutableObject {
  const next: MutableObject = {};
  Object.keys(value).forEach((key) => {
    Object.defineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: value[key],
      writable: true,
    });
  });
  return next;
}

function exists(container: MutableValue, key: string | number): boolean {
  return typeof key === "string"
    ? hasOwn(container as MutableObject, key)
    : key >= 0 && key < (container as MutableValue[]).length;
}

function child(container: MutableValue, key: string | number): MutableValue {
  return typeof key === "string"
    ? (container as MutableObject)[key]
    : (container as MutableValue[])[key];
}

function replace(
  container: Container,
  key: string | number,
  value: MutableValue,
): MutableValue[] | MutableObject {
  const next = Array.isArray(container) ? container.slice() : copyVariableObject(container);
  if (typeof key === "string") (next as MutableObject)[key] = value;
  else (next as MutableValue[])[key] = value;
  return next;
}

function updateArray(array: MutableValue[], op: string, item: MutableValue): MutableValue[] {
  if (op === "removeValue")
    return array.indexOf(item) === -1 ? array : array.filter((value) => value !== item);
  if (op === "appendUnique" && array.indexOf(item) !== -1) return array;
  return op === "prepend" ? [item].concat(array) : array.concat([item]);
}

function updateFinal(
  container: MutableValue,
  part: VariableMutationPathPart,
  operation: VariableMutationOperation,
): MutableValue {
  if (container === null) return container;
  const op = operation.op;
  if ((op === "before" || op === "after") && typeof part === "string") {
    throw new Error("Variable mutation before/after requires an array element path");
  }
  const key = pathKey(container, part);
  const found = exists(container, key);

  if (op === "remove") {
    if (!found) return container;
    const next = Array.isArray(container)
      ? container.slice()
      : copyVariableObject(container as MutableObject);
    if (Array.isArray(next)) next.splice(key as number, 1);
    else delete next[key];
    return next;
  }

  const item = (operation as { value: VariableValue }).value as MutableValue;
  if (op === "set") {
    if (typeof key === "number" && (key < 0 || key > (container as MutableValue[]).length))
      return container;
    if (found && child(container, key) === item) return container;
    return typeof key === "number" && key === (container as MutableValue[]).length
      ? (container as MutableValue[]).concat([item])
      : replace(container as MutableValue[] | MutableObject, key, item);
  }
  if (op === "before" || op === "after") {
    if (!found) return container;
    const next = (container as MutableValue[]).slice();
    next.splice((key as number) + (op === "after" ? 1 : 0), 0, item);
    return next;
  }

  const current = found ? child(container, key) : null;
  if (current === null && typeof key === "number") return container;
  if (current === null && op === "removeValue") return container;
  if (current !== null && !Array.isArray(current))
    throw new Error("Variable mutation expected an array");
  const array = (current === null ? [] : current) as MutableValue[];
  const next = updateArray(array, op, item);
  return next === current ? container : replace(container as Container, key, next);
}

function updateAtPath(
  value: MutableValue,
  operation: VariableMutationOperation,
  offset: number,
): MutableValue {
  const path = operation.path;
  if (offset === path.length) {
    if (operation.op === "set") {
      const replacement = (operation as { value: VariableValue }).value as MutableValue;
      return value === replacement ? value : replacement;
    }
    if (operation.op === "remove") throw new Error("Cannot remove the root variable value");
    if (operation.op === "before" || operation.op === "after")
      throw new Error("Variable mutation before/after requires an array element path");
    if (value === null) return value;
    if (!Array.isArray(value)) throw new Error("Variable mutation expected an array");
    const item = (operation as { value: VariableValue }).value as MutableValue;
    return updateArray(value, operation.op, item);
  }

  if (offset === path.length - 1) return updateFinal(value, path[offset], operation);
  if (value === null) return value;
  const key = pathKey(value, path[offset]);
  if (!exists(value, key)) return value;
  const current = child(value, key);
  if (current === null) return value;
  const next = updateAtPath(current, operation, offset + 1);
  return next === current ? value : replace(value as Container, key, next);
}

/** Applies compiled variable override operations without mutating the input value. */
export function applyVariableOperations(
  value: VariableValue,
  operations: VariableMutationOperation[],
): VariableValue {
  if (!Array.isArray(operations)) throw new Error("Invalid variable mutation operations");
  return operations.reduce<MutableValue>((current, operation) => {
    validateOperation(operation);
    return updateAtPath(current, operation, 0);
  }, value as MutableValue) as VariableValue;
}
