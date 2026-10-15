// SPDX-License-Identifier: AGPL-3.0-or-later
// The logo (an image in public/images), and the concept's own drawings (preset garments, its
// tool icons) as inline SVG. Other icons come from lucide, drawn with the same stroke.

type IconProps = { className?: string };

export function Logo({ size = 28 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}images/vitryne-logo-192.png`} width={size} height={size} alt="" aria-hidden="true" />;
}

function Stroke({ d, size = 20, className }: IconProps & { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const UndoIcon = (p: IconProps) => <Stroke {...p} d="M8.4 4 L3.6 8.8 L8.4 13.6 M3.6 8.8 H14.4 a6 6 0 0 1 0 12 H9.6" />;
export const RedoIcon = (p: IconProps) => <Stroke {...p} d="M15.6 4 L20.4 8.8 L15.6 13.6 M20.4 8.8 H9.6 a6 6 0 0 0 0 12 H14.4" />;
export const FabricIcon = (p: IconProps) => <Stroke {...p} size={24} d="M4 4 H20 V20 H4 Z M4 9.3 H20 M4 14.6 H20 M9.3 4 V20 M14.6 4 V20" />;
/** "Show flat pieces": a flat garment piece. */
export const FlatIcon = (p: IconProps) => <Stroke {...p} d="M7 4 L12 7 L17 4 L21 8 L18 11 V20 H6 V11 L3 8 Z" />;
/** "Show 3D": a cube. */
export const CubeIcon = (p: IconProps) => <Stroke {...p} d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M12 12 L20 7.5 M12 12 V21 M12 12 L4 7.5" />;
export const TurnIcon = (p: IconProps) => <Stroke {...p} size={22} d="M20 12 a8 8 0 1 1 -3 -6.2 M20 4 V9 H15" />;
export const PinchIcon = (p: IconProps) => (
  <Stroke {...p} size={22} d="M8 4 V12 M12 3 V12 M16 5 V12 M8 12 C5 12 4 14 6 17 L9 21 H16 C19 20 20 17 20 14 V11 C20 9 17 9 16 11" />
);
export const PresetsIcon = (p: IconProps) => (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className={p.className}>
    <path d="M9 5 L15 9 L21 5 L27 10 L23 14 V26 H7 V14 L3 10 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
export const OpenIcon = (p: IconProps) => (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className={p.className}>
    <path d="M15 21 V6 M8 12 L15 5 L22 12 M5 25 H25" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The preset drawings, by example file name. */
export const PRESET_ART: Record<string, { bg: string; art: React.ReactNode }> = {
  tshirt: {
    bg: '#E8ECE4',
    art: (
      <path
        d="M40 12 Q60 26 80 12 L108 26 L98 48 L86 42 L86 90 L34 90 L34 42 L22 48 L12 26 Z"
        fill="#9DB4A0"
        stroke="#14181F"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    ),
  },
  trousers: {
    bg: '#E9E6EE',
    art: <path d="M36 8 L84 8 L90 92 L66 92 L60 38 L54 92 L30 92 Z" fill="#23324A" stroke="#14181F" strokeWidth="2.5" strokeLinejoin="round" />,
  },
  hoodie: {
    bg: '#F1E6DF',
    art: (
      <>
        <path
          d="M34 18 L86 18 L112 34 L104 70 L90 64 L90 92 L30 92 L30 64 L16 70 L8 34 Z"
          fill="#E3A9A4"
          stroke="#14181F"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M44 18 Q60 -2 76 18" fill="none" stroke="#14181F" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M42 70 L78 70 L82 86 L38 86 Z" fill="none" stroke="#14181F" strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },
};

/** The concept's 3D "Select" arrow and flat "Move" cross. */
export const SelectIcon = (p: IconProps) => <Stroke {...p} size={22} d="M5 3 L5 19 L9.5 15 L12.5 21 L15 19.8 L12 14 L18 14 Z" />;
export const MoveIcon = (p: IconProps) => (
  <Stroke {...p} size={22} d="M12 3 V21 M3 12 H21 M9 6 L12 3 L15 6 M9 18 L12 21 L15 18 M6 9 L3 12 L6 15 M18 9 L21 12 L18 15" />
);
/** "Import your own pattern" (the concept's upload arrow). */
export const ImportIcon = OpenIcon;
