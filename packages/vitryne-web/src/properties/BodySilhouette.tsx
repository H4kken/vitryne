// SPDX-License-Identifier: AGPL-3.0-or-later
// A front outline of a body drawn from its tape measures, so bodies compare at a glance: every
// outline shares one scale and baseline (1 cm of height is the same size in all of them), and
// the widths come from the chest, waist and hip circumferences. A sketch, not the mesh.

import type { BodyOption } from "@/lib/bodies";

const W = 80;
const H = 156;
const GROUND = 151;
const PER_CM = 0.78;

export function BodySilhouette({
  body,
  className,
}: {
  body: BodyOption;
  className?: string;
}) {
  const height = (body.height / 10) * PER_CM;
  const top = GROUND - height;
  const half = (mm: number) => ((mm / 10 / Math.PI) * 0.85) / 2;
  const chest = half(body.chest);
  const waist = half(body.waist);
  const hips = half(body.hips);
  const shoulder = chest * 1.14;
  const cx = W / 2;
  const y = (f: number) => top + height * f;
  const d = [
    `M${cx - 5},${y(0.13)}`,
    `Q${cx - shoulder},${y(0.17)} ${cx - shoulder},${y(0.23)}`,
    `L${cx - chest},${y(0.32)}`,
    `Q${cx - waist},${y(0.4)} ${cx - waist},${y(0.46)}`,
    `Q${cx - hips},${y(0.5)} ${cx - hips},${y(0.54)}`,
    `L${cx - hips + 2.5},${y(0.98)} L${cx - 2},${y(0.98)} L${cx},${y(0.6)}`,
    `L${cx + 2},${y(0.98)} L${cx + hips - 2.5},${y(0.98)}`,
    `L${cx + hips},${y(0.54)}`,
    `Q${cx + hips},${y(0.5)} ${cx + waist},${y(0.46)}`,
    `Q${cx + waist},${y(0.4)} ${cx + chest},${y(0.32)}`,
    `L${cx + shoulder},${y(0.23)}`,
    `Q${cx + shoulder},${y(0.17)} ${cx + 5},${y(0.13)} Z`,
  ].join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className={className}>
      <line
        x1="4"
        x2={W - 4}
        y1={GROUND}
        y2={GROUND}
        className="stroke-border-strong"
      />
      <circle cx={cx} cy={y(0.065)} r={height * 0.052} fill="currentColor" />
      <path d={d} fill="currentColor" />
    </svg>
  );
}
