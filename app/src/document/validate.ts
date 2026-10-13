// SPDX-License-Identifier: AGPL-3.0-or-later
// The JSON Schema check a command runs on every entity it changes, before it applies
// (precompiled: scripts/gen-format.mjs). Rust then validates the whole document.

import * as validators from '@/format/validators.gen.js';
import type { EntityKind } from './entities';

interface AjvError {
  instancePath: string;
  message?: string;
}
type Validator = ((v: unknown) => boolean) & { errors?: AjvError[] | null };

const BY_KIND = validators as unknown as Record<EntityKind, Validator>;

/** Human-readable problems with `value` as a `kind`, or none. */
export function schemaErrors(kind: EntityKind, value: unknown): string[] {
  const validate = BY_KIND[kind];
  if (validate(value)) return [];
  // "/stretch/warp" -> "stretch.warp must be > 0".
  return (validate.errors ?? []).map((e) => {
    const where = e.instancePath.slice(1).replaceAll('/', '.') || kind;
    return `${where} ${e.message ?? 'is invalid'}`;
  });
}
