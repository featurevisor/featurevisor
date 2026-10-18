// taken from: https://github.com/omichelsen/compare-versions
// this is done to avoid loading the whole package

/*
The MIT License (MIT)

Copyright (c) 2015-2021 Ole Michelsen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

export const semver =
  /^[v^~<>=]*?(\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+))?(?:-([\da-z\-]+(?:\.[\da-z\-]+)*))?(?:\+[\da-z\-]+(?:\.[\da-z\-]+)*)?)?)?$/i;

export const validateAndParse = (version: string) => {
  if (typeof version !== "string") {
    throw new TypeError("Invalid argument expected string");
  }
  const match = version.match(semver);
  if (!match || match[0] !== version) {
    throw new Error(`Invalid argument not valid semver ('${version}' received)`);
  }
  match.shift();
  return match;
};

const isWildcard = (s: string) => s === "*" || s === "x" || s === "X";

const compareStrings = (a: string, b: string, prerelease: boolean) => {
  if (!prerelease && (isWildcard(a) || isWildcard(b))) return 0;
  const an = /^[0-9]+$/.test(a);
  const bn = /^[0-9]+$/.test(b);
  if (an && bn) {
    // Compare decimal strings without the host language's integer limits.
    a = a.replace(/^0+/, "") || "0";
    b = b.replace(/^0+/, "") || "0";
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  } else if (prerelease && an !== bn) {
    return an ? -1 : 1;
  }
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
};

export const compareSegments = (
  a: string | string[] | RegExpMatchArray,
  b: string | string[] | RegExpMatchArray,
  prerelease = false,
) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (prerelease && (i === a.length || i === b.length)) {
      return a.length > b.length ? 1 : -1;
    }
    const r = compareStrings(a[i] || "0", b[i] || "0", prerelease);
    if (r !== 0) return r;
  }
  return 0;
};

/** True when the version operators can compare the value, for lint and tooling. */
export const isValidVersion = (version: unknown): boolean => {
  if (typeof version !== "string") return false;
  try {
    compareVersions(version, version);
    return true;
  } catch {
    return false;
  }
};

export const compareVersions = (v1: string, v2: string) => {
  // validate input and split into segments
  const n1 = validateAndParse(v1);
  const n2 = validateAndParse(v2);

  // Separate the prerelease from the four optional core components.
  const p1 = n1.pop();
  const p2 = n2.pop();

  // validate numbers
  const r = compareSegments(n1, n2);
  if (r !== 0) return r;

  // validate pre-release
  if (p1 && p2) {
    return compareSegments(p1.split("."), p2.split("."), true);
  } else if (p1 || p2) {
    return p1 ? -1 : 1;
  }

  return 0;
};
