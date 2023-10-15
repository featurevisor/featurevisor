export function checkIfObjectsAreEqual(a, b) {
  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  if (a === null || b === null) {
    return false;
  }

  if (Object.keys(a).length !== Object.keys(b).length) {
    return false;
  }

  for (const key in a) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}
