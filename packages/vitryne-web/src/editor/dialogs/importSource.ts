// SPDX-License-Identifier: AGPL-3.0-or-later
// What the import dialog sends the worker to read: a pattern file and the file that comes with
// it, a garment.toml for a DXF or the measurements for a Valentina pattern.

import type { TextFile } from "./ImportDialog";

/** Rust `import::ImportSource`. */
export type ImportSource =
  | { kind: "dxf"; name: string; text: string; sidecar?: string }
  | {
      kind: "valentina";
      name: string;
      text: string;
      measurements?: string;
      size?: number[];
    };

export type PatternKind = ImportSource["kind"];

/** A pattern file's kind, from its name; null if it isn't one. */
export function patternKind(name: string): PatternKind | null {
  if (/\.dxf$/i.test(name)) return "dxf";
  if (/\.val$/i.test(name)) return "valentina";
  return null;
}

/** The files that can come with a pattern of this kind. */
export function companionAccept(kind: PatternKind): string {
  return kind === "dxf" ? ".toml" : ".vit,.vst";
}

export function isCompanion(kind: PatternKind, name: string): boolean {
  return kind === "dxf" ? /\.toml$/i.test(name) : /\.(vit|vst)$/i.test(name);
}

/** The source as the worker takes it (JSON). */
export function importSource(
  pattern: TextFile,
  companion: TextFile | null,
  size: number[] | null,
): string {
  const kind = patternKind(pattern.name) ?? "dxf";
  const s: ImportSource =
    kind === "dxf"
      ? {
          kind,
          name: pattern.name,
          text: pattern.text,
          sidecar: companion?.text,
        }
      : {
          kind,
          name: pattern.name,
          text: pattern.text,
          measurements: companion?.text,
          size: size ?? undefined,
        };
  return JSON.stringify(s);
}
