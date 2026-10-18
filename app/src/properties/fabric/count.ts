// SPDX-License-Identifier: AGPL-3.0-or-later

export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
