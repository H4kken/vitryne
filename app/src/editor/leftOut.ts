// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Preview } from "./ImportDialog";

/** The standard's layers the importer doesn't use, in words (ASTM D6673 layer table). */
const LAYERS: Record<string, string> = {
  "3": "curve points",
  "5": "grade reference lines",
  "9": "stripe reference lines",
  "10": "plaid reference lines",
  "11": "internal cutouts",
  "12": "intersection points",
  "13": "drill holes",
  "15": "annotation text",
};

/** What the import leaves out, one line each. */
export function leftOut(p: Preview): string[] {
  const r = p.report;
  const lines: string[] = [];
  for (const [layer, n] of r.ignored_layers) {
    lines.push(
      `${n} item${n === 1 ? "" : "s"} on layer ${layer}${LAYERS[layer] ? ` (${LAYERS[layer]})` : ""}`,
    );
  }
  if (r.blocks_without_boundary.length) {
    lines.push(
      `${r.blocks_without_boundary.length} block(s) with no closed outline, so not pieces: ${r.blocks_without_boundary.join(", ")}`,
    );
  }
  for (const [type, n] of r.skipped_entity_types)
    lines.push(
      `${n} ${type} entit${n === 1 ? "y" : "ies"} the importer doesn't read`,
    );
  if (r.bulge_segments)
    lines.push(
      `${r.bulge_segments} curved segment(s) imported as straight lines`,
    );
  if (p.unused.length)
    lines.push(`Pieces the sewing file doesn't use: ${p.unused.join(", ")}`);
  return lines;
}
