// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type Command,
  moveNodes as moveNodesCommand,
  setEdge,
  setNodeType,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import {
  curvedEdge,
  edgeLength,
  endForLength,
  isStraight,
  pointAlong,
  straightEdge,
} from "../edit";
import { PointBar } from "../PointBar";
import type { usePointTool } from "./usePointTool";

/**
 * The point tool's bar for the pick: a hint with nothing picked; a point's type and Delete; an
 * edge's kind, length (typed: the next point moves along it) and a point in its middle.
 */
export function PointToolBar({
  picked,
  shape,
  edit,
  removePicked,
  insertAt,
}: {
  picked: ReturnType<typeof usePointTool>["picked"];
  /** An outline being dragged, and why it can't be kept. */
  shape: { problem: string | null } | null;
  edit: (build: (e: Entities, garmentId: string) => Command) => void;
  removePicked: () => void;
  insertAt: ReturnType<typeof usePointTool>["insertAt"];
}) {
  const warning = shape?.problem
    ? `Can't keep this shape: ${shape.problem}`
    : undefined;
  const nodes = picked?.v.piece.outline;
  const node = nodes?.[picked?.k ?? -1];
  if (!picked || !nodes || !node)
    return <PointBar kind="hint" warning={warning} />;
  const { k, v } = picked;
  const pieceId = v.piece.id;
  if (picked.kind === "node")
    return (
      <PointBar
        kind="node"
        type={node.type}
        warning={warning}
        onType={(t) => edit((e, g) => setNodeType(e, g, pieceId, node.id, t))}
        onDelete={removePicked}
      />
    );
  const next = nodes[(k + 1) % nodes.length];
  const straight = isStraight(node.edge);
  let angle: number | undefined;
  if (straight && next) {
    const dx =
      (next.position[0] - node.position[0]) * (v.cut.mirrored ? -1 : 1);
    const dy = next.position[1] - node.position[1];
    const deg = ((Math.atan2(dy, dx) + v.t.rot) * 180) / Math.PI;
    angle = ((((deg + 180) % 360) + 360) % 360) - 180 || 0;
  }
  return (
    <PointBar
      kind="edge"
      edge={
        node.edge.type === "cubic" ? "curve" : straight ? "straight" : "traced"
      }
      length={edgeLength(nodes, k)}
      angle={angle}
      warning={warning}
      onStraight={() =>
        edit((e, g) => setEdge(e, g, pieceId, node.id, straightEdge()))
      }
      onCurve={() =>
        edit((e, g) => setEdge(e, g, pieceId, node.id, curvedEdge(nodes, k)))
      }
      onLength={(mm) =>
        next &&
        edit((e, g) =>
          moveNodesCommand(e, g, pieceId, {
            [next.id]: endForLength(nodes, k, mm),
          }),
        )
      }
      onAddPoint={() => insertAt(v, k, pointAlong(nodes, k, 0.5))}
    />
  );
}
