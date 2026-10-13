// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EngineState } from '@/worker/session';

export function StatusBar(props: { engine: EngineState; warnings: string[]; onDismissNotice: () => void }) {
  const { engine } = props;
  const s = engine.stats;
  const drapeWarnings = engine.drape?.info.warnings ?? [];
  const warnings = [...props.warnings, ...drapeWarnings];
  return (
    <footer className="text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs tabular-nums">
      {engine.notice ? (
        <button className="text-foreground truncate text-left" onClick={props.onDismissNotice} title="Dismiss">
          {engine.notice}
        </button>
      ) : (
        <span>{engine.phase === 'starting' ? 'Starting the 3D engine…' : engine.phase === 'failed' ? 'Engine stopped' : 'Ready'}</span>
      )}
      {warnings.length > 0 && (
        <span className="text-amber-400" title={warnings.join('\n')}>
          {warnings.length} warning{warnings.length > 1 ? 's' : ''}
        </span>
      )}
      {s && (
        <span className="ml-auto flex gap-4">
          <span>{s.vertices.toLocaleString()} vertices</span>
          <span>{s.fps.toFixed(0)} fps</span>
          <span title="GPU time for one frame's simulation and drawing">
            {Number.isNaN(s.frameMs) ? '–' : s.frameMs.toFixed(1)} ms/frame
          </span>
          <span>sim {s.simTime.toFixed(1)} s</span>
        </span>
      )}
    </footer>
  );
}
