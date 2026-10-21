// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Shirt } from "lucide-react";
import { thumbnailUrl } from "./projects";
import type { Cloud } from "./useCloud";

/** The project's thumbnail, or a plain garment while it has none (or it doesn't load). */
export function ProjectThumbnail({
  cloud,
  sha,
}: {
  cloud: Cloud;
  sha: string | null;
}) {
  const [src, setSrc] = useState<{ sha: string; url: string } | null>(null);
  useEffect(() => {
    if (!sha) return;
    let live = true;
    void cloud
      .backend()
      .then((b) => thumbnailUrl(b, sha))
      .then(
        (url) => live && setSrc({ sha, url }),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [cloud, sha]);
  const url = src && src.sha === sha ? src.url : null;
  return (
    <span className="bg-canvas-3d flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <Shirt
          className="size-14 text-[#B9C0B4]"
          strokeWidth={1.2}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
