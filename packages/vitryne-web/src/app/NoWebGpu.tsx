// SPDX-License-Identifier: AGPL-3.0-or-later
// Phones, Firefox on some systems and old GPUs land here, and so do most clicks from a shared
// link: the page says what Vitryne is and shows it working before saying where it runs.
import { REPO_URL } from "@/links";
import { SUPPORTED_BROWSERS } from "@/webgpu";
import { InfoPage } from "./InfoPage";

const DEMOS: [string, string, string][] = [
  [
    "pattern-drafting",
    "Draw a pattern",
    "Drawing a skirt piece with the pen, a typed length and a curved hem, then notches, a grain line and an edited point",
  ],
  [
    "sewing",
    "Sew it",
    "Sewing an unsewn T-shirt from the seam suggestions and the two-click Sew tool, then draping it",
  ],
  [
    "pinch-and-place",
    "Drape, place and pinch",
    "Placing the front of a T-shirt with its handles, draping it again, then pinching and pulling the hem",
  ],
  [
    "fabric-presets",
    "Try fabrics",
    "The same T-shirt draped again in denim, then in fleece",
  ],
];

export function NoWebGpu({ reason }: { reason: string }) {
  return (
    <InfoPage title="Garment design in your browser">
      <p className="text-body-text m-0 text-[19px] leading-normal">
        Draw a pattern, sew it, drape it on a body and export it, in a browser
        tab. Free and open source.
      </p>
      <div className="bg-card flex flex-col gap-2 rounded-2xl border p-5">
        <p className="m-0 text-[17px] font-semibold">
          Open Vitryne on a computer to try it
        </p>
        <p className="text-body-text m-0 text-[15px] leading-normal">
          It works in {SUPPORTED_BROWSERS}, on a device with a GPU those
          browsers can use: the 3D view runs in your browser. Here: {reason}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[15px] font-semibold">
        <a href={REPO_URL} className="underline underline-offset-4">
          Source code on GitHub
        </a>
        <a href={`${REPO_URL}#readme`} className="underline underline-offset-4">
          What works today
        </a>
      </div>
      <div className="grid grid-cols-1 gap-6 pt-4 pb-14 sm:grid-cols-2">
        {DEMOS.map(([file, title, alt]) => (
          <figure key={file} className="m-0 flex flex-col gap-2">
            <img
              src={`${import.meta.env.BASE_URL}landing/${file}.webp`}
              alt={alt}
              width={640}
              height={360}
              loading="lazy"
              className="h-auto w-full rounded-xl border"
            />
            <figcaption className="text-[15px] font-semibold">
              {title}
            </figcaption>
          </figure>
        ))}
      </div>
    </InfoPage>
  );
}
