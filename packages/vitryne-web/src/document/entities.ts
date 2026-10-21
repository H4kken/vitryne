// SPDX-License-Identifier: AGPL-3.0-or-later
// The document as the UI holds it: the file's entities, exactly as Rust's
// `vitryne_format::Entities` gives them (unknown members included).

import type {
  Appearance,
  Avatar,
  Fabric,
  Garment,
  Project,
  View,
} from "@/format/schema.gen";

export type Kind = "project" | "garment" | "fabric" | "avatar";

export interface Entities {
  kind: Kind;
  project?: Project;
  garments: Garment[];
  fabrics: Fabric[];
  /** Absent when there are none (format version 2). */
  appearances?: Appearance[];
  avatars: Avatar[];
  view?: View;
}

/** Where an entity sits in the document. */
export type Slot =
  | { kind: "project" }
  | { kind: "view" }
  | { kind: "garment"; id: string }
  | { kind: "fabric"; id: string }
  | { kind: "appearance"; id: string }
  | { kind: "avatar"; id: string };

export type EntityKind = Slot["kind"];

const LIST = {
  garment: "garments",
  fabric: "fabrics",
  appearance: "appearances",
  avatar: "avatars",
} as const;

export function slotKey(s: Slot): string {
  return "id" in s ? `${s.kind}:${s.id}` : s.kind;
}

export function getEntity(e: Entities, s: Slot): unknown {
  if (s.kind === "project" || s.kind === "view") return e[s.kind];
  return ((e[LIST[s.kind]] ?? []) as { id: string }[]).find(
    (x) => x.id === s.id,
  );
}

/** A copy of `e` with the entity at `s` replaced, added (if not yet in list), or removed (if value is undefined). */
export function setEntity(e: Entities, s: Slot, value: unknown): Entities {
  if (s.kind === "project" || s.kind === "view") {
    if (value === undefined) throw new Error(`the ${s.kind} can't be removed`);
    return { ...e, [s.kind]: value };
  }
  const list = (e[LIST[s.kind]] ?? []) as { id: string }[];
  const i = list.findIndex((x) => x.id === s.id);
  if (value === undefined) {
    if (i < 0) return e;
    const copy = list.slice();
    copy.splice(i, 1);
    // Rust leaves out an empty list of appearances (format version 2): so does the editor.
    if (s.kind === "appearance" && copy.length === 0) {
      const out = { ...e };
      delete out.appearances;
      return out;
    }
    return { ...e, [LIST[s.kind]]: copy };
  }
  if ((value as { id?: unknown }).id !== s.id)
    throw new Error(`a command can't change a ${s.kind}'s id`);
  const copy = list.slice();
  if (i >= 0) copy[i] = value as { id: string };
  else {
    // A new one goes where the project lists it (an undone removal goes back to its place),
    // else last.
    const order = projectOrder(e, s.kind);
    const at = order.indexOf(s.id);
    const after = at < 0 ? -1 : copy.findIndex((x) => order.indexOf(x.id) > at);
    if (after < 0) copy.push(value as { id: string });
    else copy.splice(after, 0, value as { id: string });
  }
  return { ...e, [LIST[s.kind]]: copy };
}

/** The project's list of a kind's ids (its garments, fabrics, appearances), if it has one. */
function projectOrder(e: Entities, kind: EntityKind): readonly string[] {
  if (kind === "garment") return e.project?.garments ?? [];
  if (kind === "fabric") return e.project?.fabrics ?? [];
  if (kind === "appearance") return e.project?.appearances ?? [];
  return [];
}

export function parseEntities(json: string): Entities {
  const e = JSON.parse(json) as Entities;
  if (
    !e ||
    typeof e !== "object" ||
    !Array.isArray(e.garments) ||
    !Array.isArray(e.fabrics) ||
    !Array.isArray(e.avatars)
  ) {
    throw new Error(
      "the engine sent a document the editor does not understand",
    );
  }
  return e;
}

/** The project's garment the MVP edits and drapes (the first). */
export function mainGarment(e: Entities): Garment | undefined {
  const id = e.project?.garments[0];
  return id ? e.garments.find((g) => g.id === id) : e.garments[0];
}
