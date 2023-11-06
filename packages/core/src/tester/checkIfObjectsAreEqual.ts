export function checkIfObjectsAreEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }

  const keysA = Object.keys(a),
    keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!keysB.includes(key) || !checkIfObjectsAreEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}