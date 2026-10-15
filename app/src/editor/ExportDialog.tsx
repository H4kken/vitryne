// SPDX-License-Identifier: AGPL-3.0-or-later
// Dialog to export the draped garment as glTF 2.0 (.glb) or Wavefront OBJ (.obj + .mtl), or its
// pattern pieces as DXF-AAMA (.dxf, M13; no drape needed, no account needed).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { EngineSession } from '@/worker/session';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: EngineSession;
  garmentName: string;
}

type ExportFormat = 'glb' | 'obj' | 'dxf';

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

interface FilePickerWindow {
  showSaveFilePicker?(o: unknown): Promise<FileSystemFileHandle>;
}

export function ExportDialog({ open, onOpenChange, session, garmentName }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('glb');
  const [includeAvatar, setIncludeAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After a DXF export: the file's name and what the export says about it. */
  const [dxfDone, setDxfDone] = useState<{ name: string; notes: string[] } | null>(null);

  const cleanName = garmentName.trim().replace(/[\\/:*?"<>|]/g, '_') || 'garment';

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      if (format === 'dxf') {
        const { text, notes } = await session.exportDxf();
        const name = `${cleanName}.dxf`;
        const blob = new Blob([text], { type: 'application/dxf' });
        const win = window as unknown as FilePickerWindow;
        let saved = false;
        if (typeof win.showSaveFilePicker === 'function') {
          try {
            const handle = await win.showSaveFilePicker({
              suggestedName: name,
              types: [{ description: 'DXF-AAMA pattern', accept: { 'application/dxf': ['.dxf'] } }],
            });
            const w = await (handle as FileSystemFileHandle & { createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }).createWritable();
            await w.write(blob);
            await w.close();
            saved = true;
          } catch (e) {
            if (cancelled(e)) return;
            // Fall back to browser download
          }
        }
        if (!saved) downloadBlob(name, blob);
        setDxfDone({ name, notes });
      } else if (format === 'glb') {
        const glb = await session.exportGlb(includeAvatar);
        const win = window as unknown as FilePickerWindow;
        if (typeof win.showSaveFilePicker === 'function') {
          try {
            const handle = await win.showSaveFilePicker({
              suggestedName: `${cleanName}.glb`,
              types: [{ description: 'glTF 2.0 Binary', accept: { 'model/gltf-binary': ['.glb'] } }],
            });
            const w = await (handle as FileSystemFileHandle & { createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }> }).createWritable();
            await w.write(glb);
            await w.close();
            onOpenChange(false);
            return;
          } catch (e) {
            if (cancelled(e)) {
              setBusy(false);
              return;
            }
            // Fall back to browser download
          }
        }
        downloadBlob(`${cleanName}.glb`, new Blob([glb], { type: 'model/gltf-binary' }));
        onOpenChange(false);
      } else {
        const res = await session.exportObj(includeAvatar);
        downloadBlob(`${cleanName}.obj`, new Blob([res.obj], { type: 'text/plain' }));
        downloadBlob(`${cleanName}.mtl`, new Blob([res.mtl], { type: 'text/plain' }));
        onOpenChange(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setDxfDone(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[480px] rounded-2xl bg-white p-6 shadow-xl">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="font-display text-xl font-semibold">Export</DialogTitle>
          <DialogDescription className="text-muted-foreground text-[14px]">
            {format === 'dxf'
              ? 'Export the pattern pieces for cutting and CAD tools.'
              : 'Export the draped garment at current positions with 2D pattern UVs and fabric materials.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Format selection */}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Format</span>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#F4F5F2] p-1">
              <button
                type="button"
                aria-pressed={format === 'glb'}
                onClick={() => setFormat('glb')}
                className={cn(
                  'flex flex-col items-center justify-center rounded-[9px] py-2.5 px-3 text-center transition-all',
                  format === 'glb' ? 'bg-white font-semibold shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground font-medium'
                )}
              >
                <span className="text-[14px]">glTF 2.0 (.glb)</span>
                <span className="text-[11px] opacity-75">Recommended</span>
              </button>
              <button
                type="button"
                aria-pressed={format === 'obj'}
                onClick={() => setFormat('obj')}
                className={cn(
                  'flex flex-col items-center justify-center rounded-[9px] py-2.5 px-3 text-center transition-all',
                  format === 'obj' ? 'bg-white font-semibold shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground font-medium'
                )}
              >
                <span className="text-[14px]">Wavefront (.obj)</span>
                <span className="text-[11px] opacity-75">.obj + .mtl</span>
              </button>
              <button
                type="button"
                aria-pressed={format === 'dxf'}
                onClick={() => {
                  setFormat('dxf');
                  setDxfDone(null);
                }}
                className={cn(
                  'flex flex-col items-center justify-center rounded-[9px] py-2.5 px-3 text-center transition-all',
                  format === 'dxf' ? 'bg-white font-semibold shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground font-medium'
                )}
              >
                <span className="text-[14px]">Pattern (.dxf)</span>
                <span className="text-[11px] opacity-75">DXF-AAMA</span>
              </button>
            </div>
          </div>

          {/* Include avatar toggle */}
          {format !== 'dxf' && (
          <div className="flex items-center justify-between rounded-xl bg-[#F8F9F7] px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="include-avatar" className="cursor-pointer text-[14px] font-medium">
                Include avatar
              </Label>
              <span className="text-muted-foreground text-[12px]">Add the body collider mesh as a separate object</span>
            </div>
            <Switch id="include-avatar" checked={includeAvatar} onCheckedChange={setIncludeAvatar} />
          </div>
          )}

          {/* Details callout (after a DXF export, its notes say the same) */}
          {!dxfDone && (
          <div className="rounded-xl border border-[#E5E8E2] bg-[#FAFAF8] p-3.5 text-[13px] leading-relaxed text-[#5A6054]">
            {format === 'dxf' ? (
              <p className="m-0">
                One block per piece, in <strong>millimetres</strong>. The outlines are the <strong>sewing lines</strong>: there is no
                seam allowance yet, so add it in your CAD tool before cutting. Pieces cut on the fold are written as a half with a mirror
                line.
              </p>
            ) : (
              <p className="m-0">
                Coordinates and UVs are in <strong>metres</strong> (+Y up, +Z facing). Textures map 1:1 to pattern pieces like printed
                fabric.
              </p>
            )}
          </div>
          )}

          {dxfDone && (
            <div role="status" className="rounded-xl border border-[#E5E8E2] bg-white p-3.5 text-[13px] leading-relaxed">
              <p className="m-0 font-semibold">Saved {dxfDone.name}</p>
              <ul className="m-0 mt-1.5 list-disc pl-5 text-[#5A6054]">
                {dxfDone.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 flex flex-row justify-end gap-2 sm:gap-2">
          {dxfDone ? (
            <Button
              onClick={() => {
                setDxfDone(null);
                onOpenChange(false);
              }}
              className="min-w-24"
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void onExport()} disabled={busy} className="min-w-24">
                {busy ? 'Exporting…' : 'Export'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
