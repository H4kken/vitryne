// SPDX-License-Identifier: AGPL-3.0-or-later
// What each Download format needs from the person, so the panel and its test agree.

export type ExportFormat = "png" | "glb" | "obj" | "vtry";

export interface ExportOptions {
  /** The avatar switch: for a picture (on by default), for a 3D model (off), or none. */
  avatar: "image" | "model" | null;
}

export function exportOptions(format: ExportFormat): ExportOptions {
  switch (format) {
    case "png":
      return { avatar: "image" };
    case "glb":
    case "obj":
      return { avatar: "model" };
    case "vtry":
      return { avatar: null };
  }
}
