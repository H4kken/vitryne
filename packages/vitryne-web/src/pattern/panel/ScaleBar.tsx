// SPDX-License-Identifier: AGPL-3.0-or-later

/** The scale bar's longest length on screen, pixels. */
const SCALE_MAX_PX = 120;

/** A map's scale bar: the longest round length (1, 2 or 5 times a power of ten mm) that fits. */
export function ScaleBar({ mmPerPx }: { mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  const most = SCALE_MAX_PX * mmPerPx;
  const pow = 10 ** Math.floor(Math.log10(most));
  const mm = [5, 2, 1].map((k) => k * pow).find((v) => v <= most) ?? pow;
  const label =
    mm >= 1000
      ? `${mm / 1000} m`
      : mm >= 10
        ? `${mm / 10} cm`
        : `${+mm.toPrecision(3)} mm`;
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex flex-col items-end gap-1 text-[12px] font-medium text-[#4A514B]">
      <span>{label}</span>
      <span
        className="h-1.5 border-x-[1.5px] border-b-[1.5px] border-[#4A514B]"
        style={{ width: mm / mmPerPx }}
      />
    </div>
  );
}
