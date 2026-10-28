// SPDX-License-Identifier: AGPL-3.0-or-later
// The rail beside the Layers list: which way is outside and which is the body.

const label =
  "text-faint [writing-mode:vertical-rl] rotate-180 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase";

export function DirectionRail() {
  return (
    <div
      aria-hidden
      className="flex flex-col items-center"
      title="Outside is at the top, next to the body at the bottom"
    >
      <span className={label}>Outside</span>
      <span className="bg-border relative my-1 w-[1.5px] flex-1">
        <span className="border-border absolute top-0 left-1/2 size-[7px] -translate-x-1/2 rotate-45 border-t-[1.5px] border-l-[1.5px]" />
      </span>
      <span className={label}>Body</span>
    </div>
  );
}
