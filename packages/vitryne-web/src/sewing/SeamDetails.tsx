// SPDX-License-Identifier: AGPL-3.0-or-later
import { Trash2 } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { removeSeam, renameSeam, reverseSeam } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment, Seam } from "@/format/schema.gen";
import { describeSide, differenceNote, sideTitle } from "./api";
import type { Sewing } from "./SeamsSection";
import { seamTitle } from "./seamTitle";
import { TextField } from "@/properties/TextField";

/** One seam's page: its name, which way it is sewn, and deleting it. */
export function SeamDetails(props: {
  store: DocumentStore;
  garment: Garment;
  seam: Seam;
  sewing: Sewing;
}) {
  const { store, garment: g, seam, sewing } = props;
  const note = differenceNote(sewing.differences[seam.id]);
  return (
    <div className="flex flex-col gap-4">
      <BackLink onClick={() => sewing.onOpen(null)}>All seams</BackLink>
      <h2 className="m-0 text-[17px] font-semibold">{seamTitle(g, seam)}</h2>
      <TextField
        label="Description"
        value={seam.name ?? ""}
        placeholder={`${sideTitle(g, seam.a)} with ${sideTitle(g, seam.b)}`}
        onCommit={(v) => store.execute((e) => renameSeam(e, g.id, seam.id, v))}
      />
      <div className="text-muted-foreground flex flex-col gap-1 text-[13px] leading-snug">
        <span>{describeSide(g, seam.a)}</span>
        <span>{describeSide(g, seam.b)}</span>
        {note && <span className="text-foreground">{note}</span>}
      </div>
      <div className="flex flex-col gap-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={() => store.execute((e) => reverseSeam(e, g.id, seam.id))}
        >
          Flip direction
        </Button>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (store.execute((e) => removeSeam(e, g.id, seam.id)))
              sewing.onOpen(null);
          }}
        >
          <Trash2 className="size-4" />
          Delete seam
        </Button>
      </div>
    </div>
  );
}
