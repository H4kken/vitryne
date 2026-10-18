// SPDX-License-Identifier: AGPL-3.0-or-later

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
