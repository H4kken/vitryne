// SPDX-License-Identifier: AGPL-3.0-or-later
import { MarkBar } from "../MarkBar";
import type { useMarksTool } from "./useMarksTool";

/** The marks tool's bar for what is being drawn or picked. */
export function MarkToolBar({
  marks,
}: {
  marks: ReturnType<typeof useMarksTool>;
}) {
  const {
    markKind,
    setMarkKind,
    lineDraft,
    setLineDraft,
    foldFrom,
    setFoldFrom,
    markPicked,
    markWarning,
    lineCut,
    lineProblem,
    finishLine,
    removeMark,
  } = marks;
  return (
    <MarkBar
      kind={markKind}
      onKind={setMarkKind}
      drawing={
        lineDraft
          ? {
              points: lineDraft.points.length,
              onFinish: finishLine,
              onUndo: () =>
                setLineDraft((d) =>
                  d ? { ...d, points: d.points.slice(0, -1) } : d,
                ),
              onCancel: () => setLineDraft(null),
            }
          : undefined
      }
      folding={foldFrom ? { onCancel: () => setFoldFrom(null) } : undefined}
      picked={
        markPicked ? { what: markPicked.kind, onRemove: removeMark } : undefined
      }
      warning={
        markWarning ??
        (lineDraft && lineCut
          ? (() => {
              const live = lineDraft.cursor
                ? [
                    ...lineDraft.points,
                    {
                      at: lineDraft.cursor,
                      ...(lineDraft.handle ? { out: lineDraft.handle } : {}),
                    },
                  ]
                : lineDraft.points;
              const why = lineProblem(lineCut, live);
              return why ? `Can't keep this line: ${why}` : undefined;
            })()
          : undefined)
      }
    />
  );
}
