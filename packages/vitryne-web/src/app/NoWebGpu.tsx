// SPDX-License-Identifier: AGPL-3.0-or-later
import { SUPPORTED_BROWSERS } from "@/webgpu";
import { InfoPage } from "./InfoPage";

export function NoWebGpu({ reason }: { reason: string }) {
  return (
    <InfoPage title="This browser can't show the 3D view">
      <p className="text-body-text m-0 text-[19px] leading-normal">{reason}</p>
      <p className="text-body-text m-0 text-[17px] leading-normal">
        Vitryne works in {SUPPORTED_BROWSERS}, on a device with a GPU those
        browsers can use: the 3D view runs in your browser.
      </p>
    </InfoPage>
  );
}
