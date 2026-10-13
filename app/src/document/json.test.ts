// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deepEqual, deepFreeze, setIn } from './json';

describe('setIn', () => {
  it('keeps key order, appends new keys, removes with undefined, copies only the path', () => {
    const v = { a: 1, b: { c: 2, d: 3 }, e: [1, 2] };
    const w = setIn(v, ['b', 'c'], 9);
    expect(Object.keys(w.b)).toEqual(['c', 'd']);
    expect(w.b.c).toBe(9);
    expect(w.e).toBe(v.e);
    expect(v.b.c).toBe(2);
    expect(Object.keys(setIn(v, ['z'], 0))).toEqual(['a', 'b', 'e', 'z']);
    expect(Object.keys(setIn(v, ['a'], undefined))).toEqual(['b', 'e']);
    expect(setIn(v, ['e', 1], 5).e).toEqual([1, 5]);
    expect(() => setIn(v, ['e', 2], 5)).toThrow();
    expect(setIn({}, ['x', 'y'], true)).toEqual({ x: { y: true } });
  });
});

describe('deepEqual', () => {
  it('treats key order as significant', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});

describe('deepFreeze', () => {
  it('makes a stray mutation throw', () => {
    const v = deepFreeze({ a: { b: [1] } });
    expect(() => {
      (v.a.b as number[]).push(2);
    }).toThrow();
    expect(() => {
      (v.a as { b: unknown }).b = 0;
    }).toThrow();
  });
});
