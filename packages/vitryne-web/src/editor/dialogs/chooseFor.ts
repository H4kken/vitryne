// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The import dialog's choices after `name` gets `value`. A piece left out can't carry others, so
 * the pieces that were on it (and those on them) are dropped and choose again.
 */
export function chooseFor(
  choices: Record<string, string>,
  name: string,
  value: string,
): Record<string, string> {
  let next = { ...choices, [name]: value };
  let gone = value === "leave" ? [name] : [];
  while (gone.length) {
    const on = new Set(gone.map((n) => `on:${n}`));
    const dropped = Object.entries(next)
      .filter(([, choice]) => on.has(choice))
      .map(([n]) => n);
    next = Object.fromEntries(
      Object.entries(next).filter(([n]) => !dropped.includes(n)),
    );
    gone = dropped;
  }
  return next;
}
