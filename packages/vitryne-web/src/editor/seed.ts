// SPDX-License-Identifier: AGPL-3.0-or-later

/** Random bytes for new ids (the worker makes ids from them). */
export const seed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)));
