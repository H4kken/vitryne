// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FileRef } from "@/storage/storage";

/** Where the open document lives: a navigation target and its path, to compare with the URL. */
export type DocRoute =
  | { path: string; to: "/" }
  | { path: string; to: "/new" }
  | { path: string; to: "/design/$id"; params: { id: string } }
  | { path: string; to: "/example/$name"; params: { name: string } };

/**
 * The URL of what is open: nothing (`/`), a cloud project (`/design/$id`), an example not
 * changed yet (`/example/$name`), or a project before its first save (`/new`).
 */
export function docRoute(ref: FileRef | null, empty: boolean): DocRoute {
  if (empty) return { path: "/", to: "/" };
  if (ref?.cloud) {
    const id = ref.cloud.id;
    return { path: `/design/${id}`, to: "/design/$id", params: { id } };
  }
  if (ref?.example) {
    const name = ref.example;
    return { path: `/example/${name}`, to: "/example/$name", params: { name } };
  }
  return { path: "/new", to: "/new" };
}
