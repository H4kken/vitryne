// SPDX-License-Identifier: AGPL-3.0-or-later

/** The preset drawings, by example file name. */
export const PRESET_ART: Record<string, { bg: string; art: React.ReactNode }> =
  {
    tshirt: {
      bg: "#E8ECE4",
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
      bg: "#E9E6EE",
      art: (
        <path
          d="M36 8 L84 8 L90 92 L66 92 L60 38 L54 92 L30 92 Z"
          fill="#23324A"
          stroke="#14181F"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      ),
    },
    hoodie: {
      bg: "#F1E6DF",
      art: (
        <>
          <path
            d="M34 18 L86 18 L112 34 L104 70 L90 64 L90 92 L30 92 L30 64 L16 70 L8 34 Z"
            fill="#E3A9A4"
            stroke="#14181F"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M44 18 Q60 -2 76 18"
            fill="none"
            stroke="#14181F"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M42 70 L78 70 L82 86 L38 86 Z"
            fill="none"
            stroke="#14181F"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </>
      ),
    },
  };
