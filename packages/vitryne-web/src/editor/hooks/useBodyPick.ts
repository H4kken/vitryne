// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback } from "react";
import type { Entities } from "@/document/entities";
import type { EngineSession } from "@/worker/session";
import { bodyPart } from "./bodyPart";

/**
 * Which part of the body is under a screen point of the 3D view (a zone key, see `bodyPart`), or
 * null when the point is off the view or off the body.
 */
export function useBodyPick(session: EngineSession, entities: Entities) {
  const avatar = entities.avatars[0];
  return useCallback(
    async (clientX: number, clientY: number): Promise<string | null> => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "canvas[data-viewport]",
      );
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      if (
        clientX < r.left ||
        clientX > r.right ||
        clientY < r.top ||
        clientY > r.bottom
      )
        return null;
      const point = await session.pickBody(
        ((clientX - r.left) / r.width) * 2 - 1,
        1 - ((clientY - r.top) / r.height) * 2,
      );
      return point ? bodyPart(point, avatar) : null;
    },
    [session, avatar],
  );
}

export type PickPart = ReturnType<typeof useBodyPick>;
