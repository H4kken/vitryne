// SPDX-License-Identifier: AGPL-3.0-or-later
// Plain JSON values, compared and updated without mutation.

export type Json =
  null | boolean | number | string | Json[] | { [k: string]: Json };

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  // Key order is part of the file (unknown members are written in order).
  return (
    ka.length === kb.length &&
    ka.every(
      (k, i) =>
        k === kb[i] &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

/** Freezes `v` and everything in it, so an accidental mutation throws (strict mode). */
export function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

export type Path = readonly (string | number)[];

export function getIn(v: unknown, path: Path): unknown {
  let cur = v;
  for (const k of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/**
 * A copy of `v` with `path` set to `value` (`undefined` removes an object member). Only the
 * containers on the path are copied; an existing member keeps its place among its siblings,
 * a new one goes last. Missing containers on the path are created as objects.
 */
export function setIn<T>(v: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [k, ...rest] = path as [string | number, ...(string | number)[]];
  if (Array.isArray(v)) {
    if (typeof k !== "number" || k < 0 || k >= v.length)
      throw new Error(`no index ${String(k)} in an array of ${v.length}`);
    const copy = v.slice();
    copy[k] = setIn(v[k], rest, value);
    return copy as T;
  }
  const obj = (typeof v === "object" && v !== null ? v : {}) as Record<
    string,
    unknown
  >;
  const key = String(k);
  const next = rest.length === 0 ? value : setIn(obj[key], rest, value);
  const copy: Record<string, unknown> = {};
  let placed = false;
  for (const [kk, vv] of Object.entries(obj)) {
    if (kk === key) {
      placed = true;
      if (next !== undefined) copy[kk] = next;
    } else copy[kk] = vv;
  }
  if (!placed && next !== undefined) copy[key] = next;
  return copy as T;
}
