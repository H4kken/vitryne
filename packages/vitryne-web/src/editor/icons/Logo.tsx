// SPDX-License-Identifier: AGPL-3.0-or-later
// The logo (an image in public/images).

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}images/vitryne-logo-192.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
