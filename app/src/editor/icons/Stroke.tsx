// SPDX-License-Identifier: AGPL-3.0-or-later
// The concept's own tool icons are inline SVG strokes, like lucide's (which draws the others).

export type IconProps = { className?: string };

export function Stroke({
  d,
  size = 20,
  className,
}: IconProps & { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
