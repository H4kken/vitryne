// SPDX-License-Identifier: AGPL-3.0-or-later
// The Fabric panel: the project's fabrics, each a kind (how it hangs) and a colour (how it
// looks). Make one from a preset, or copy one from another project; the Pieces panel then gives
// fabrics to pieces. Every change goes through a command (document/commands.ts).

import type { ProjectFabric } from "@/cloud/fabrics";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import { NewFabric } from "./fabric/NewFabric";
import { FromProjects } from "./fabric/FromProjects";
import { FabricDetails } from "./fabric/FabricDetails";
import { FabricList } from "./fabric/FabricList";

/** Which part of the panel shows. `forPiece`: a new fabric is for that piece (from Pieces). */
export type FabricView =
  | { kind: "list" }
  | { kind: "new"; forPiece?: { id: string; name: string } }
  | { kind: "fabric"; id: string }
  | { kind: "import" };

export function FabricPanel(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  view: FabricView;
  onView: (v: FabricView) => void;
  /** Gives the new fabric to the piece it was made for, then shows that piece. */
  onMadeForPiece: () => void;
  /** The fabrics of the person's other projects; null without an account. */
  loadOthers: (() => Promise<ProjectFabric[]>) | null;
}) {
  const { view } = props;
  if (view.kind === "new")
    return <NewFabric {...props} forPiece={view.forPiece} />;
  if (view.kind === "import") return <FromProjects {...props} />;
  if (view.kind === "fabric") {
    const f = props.entities.fabrics.find((x) => x.id === view.id);
    if (f) return <FabricDetails {...props} fabric={f} />;
  }
  return <FabricList {...props} />;
}
