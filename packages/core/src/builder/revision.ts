export function getNextRevision(currentRevision: string) {
  // If the string is empty or can't be parsed with parseInt(), return "1".
  if (!currentRevision || isNaN(parseInt(currentRevision, 10))) {
    return "1";
  }

  // If the string is like an integer, increment it by 1 and return the value.
  if (currentRevision.indexOf(".") === -1) {
    return (parseInt(currentRevision, 10) + 1).toString();
  }

  // If the string is a semver, parse the patch version out of it, increment it by one and return it.
  const parts = currentRevision.split(".");
  const lastPart = parseInt(parts[parts.length - 1], 10);

  if (!isNaN(lastPart)) {
    return (lastPart + 1).toString();
  }

  // If the string can't be parsed as a semver, return "1".
  return "1";
}
