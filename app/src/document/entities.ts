// SPDX-License-Identifier: AGPL-3.0-or-later
// The document as the UI holds it: the file's entities, exactly as Rust's
// `vitryne_format::Entities` gives them (unknown members included).

import type { Avatar, Fabric, Garment, Project, View } from '@/format/schema.gen';

export type Kind = 'project' | 'garment' | 'fabric' | 'avatar';

export interface Entities {
  kind: Kind;
  project?: Project;
  garments: Garment[];
  fabrics: Fabric[];
  avatars: Avatar[];
  view?: View;
}

/** Where an entity sits in the document. */
export type Slot =
  | { kind: 'project' }
  | { kind: 'view' }
  | { kind: 'garment'; id: string }
  | { kind: 'fabric'; id: string }
  | { kind: 'avatar'; id: string };

export type EntityKind = Slot['kind'];

const LIST = { garment: 'garments', fabric: 'fabrics', avatar: 'avatars' } as const;

export function slotKey(s: Slot): string {
  return 'id' in s ? `${s.kind}:${s.id}` : s.kind;
}

export function getEntity(e: Entities, s: Slot): unknown {
  if (s.kind === 'project' || s.kind === 'view') return e[s.kind];
  return (e[LIST[s.kind]] as { id: string }[]).find((x) => x.id === s.id);
}

/** A copy of `e` with the entity at `s` replaced (it must exist: commands don't add or remove entities yet). */
export function setEntity(e: Entities, s: Slot, value: unknown): Entities {
  if (s.kind === 'project' || s.kind === 'view') {
    if (value === undefined) throw new Error(`the ${s.kind} can't be removed`);
    return { ...e, [s.kind]: value };
  }
  const list = e[LIST[s.kind]] as { id: string }[];
  const i = list.findIndex((x) => x.id === s.id);
  if (i < 0) throw new Error(`no ${s.kind} ${s.id}`);
  if (value === undefined || (value as { id?: unknown }).id !== s.id) throw new Error(`a command can't change a ${s.kind}'s id`);
  const copy = list.slice();
  copy[i] = value as { id: string };
  return { ...e, [LIST[s.kind]]: copy };
}

export function parseEntities(json: string): Entities {
  const e = JSON.parse(json) as Entities;
  if (!e || typeof e !== 'object' || !Array.isArray(e.garments) || !Array.isArray(e.fabrics) || !Array.isArray(e.avatars)) {
    throw new Error('the engine sent a document the editor does not understand');
  }
  return e;
}

/** The project's garment the MVP edits and drapes (the first). */
export function mainGarment(e: Entities): Garment | undefined {
  const id = e.project?.garments[0];
  return id ? e.garments.find((g) => g.id === id) : e.garments[0];
}
