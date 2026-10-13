// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Editor } from './editor/Editor';
import { checkWebGpu, type GpuCheck, SUPPORTED_BROWSERS } from './webgpu';

export function App() {
  const [gpu, setGpu] = useState<GpuCheck | null>(null);
  useEffect(() => {
    void checkWebGpu().then(setGpu);
  }, []);
  if (!gpu) return null;
  if (!gpu.ok) return <NoWebGpu reason={gpu.reason} />;
  return (
    <TooltipProvider delayDuration={400}>
      <Editor />
    </TooltipProvider>
  );
}

function NoWebGpu({ reason }: { reason: string }) {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-3">
        <h1 className="text-lg font-semibold">Vitryne needs WebGPU</h1>
        <p className="text-muted-foreground text-sm">{reason}</p>
        <p className="text-sm">
          It works in {SUPPORTED_BROWSERS}, on a device with a GPU those browsers can use. Nothing is sent anywhere:
          Vitryne runs entirely in your browser.
        </p>
      </div>
    </main>
  );
}
