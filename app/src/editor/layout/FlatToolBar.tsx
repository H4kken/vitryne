// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link2, Spline, PencilRuler, PenTool, SquarePlus } from "lucide-react";

import { SelectIcon } from "../icons/SelectIcon";
import { ToolButton } from "./ToolButton";
import type { FlatTool } from "@/pattern/panel/types";

/** The flat view's floating tool bar: Select, the pattern tools, and Sew. */
export function FlatToolBar({
  flatTool,
  setFlatTool,
  onSew,
}: {
  flatTool: FlatTool;
  setFlatTool: (t: FlatTool) => void;
  /** The sew tool picked (it shows the seams in the Pieces panel). */
  onSew: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-[#14181F] p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
      <ToolButton
        label="Select"
        selected={flatTool === "select"}
        onClick={() => setFlatTool("select")}
      >
        <SelectIcon />
      </ToolButton>
      <ToolButton
        label="Edit points"
        selected={flatTool === "points"}
        onClick={() => setFlatTool("points")}
      >
        <Spline className="size-5" />
      </ToolButton>
      <ToolButton
        label="Draw a piece"
        selected={flatTool === "draw"}
        onClick={() => setFlatTool("draw")}
      >
        <PenTool className="size-5" />
      </ToolButton>
      <ToolButton
        label="Lines, notches, folds and grain"
        selected={flatTool === "marks"}
        onClick={() => setFlatTool("marks")}
      >
        <PencilRuler className="size-5" />
      </ToolButton>
      <ToolButton
        label="Add a shape"
        selected={flatTool === "shape"}
        onClick={() => setFlatTool("shape")}
      >
        <SquarePlus className="size-5" />
      </ToolButton>
      <ToolButton
        label="Sew two edges"
        selected={flatTool === "sew"}
        onClick={onSew}
      >
        <Link2 className="size-5" />
      </ToolButton>
    </div>
  );
}
