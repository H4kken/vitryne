// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkWebGpu, type GpuCheck } from "./webgpu";
import { NoWebGpu } from "./app/NoWebGpu";
import { WithBackend } from "./app/WithBackend";

export function App() {
  const [gpu, setGpu] = useState<GpuCheck | null>(null);
  useEffect(() => {
    void checkWebGpu().then(setGpu);
  }, []);
  if (!gpu) return null;
  if (!gpu.ok) return <NoWebGpu reason={gpu.reason} />;
  return (
    <TooltipProvider delayDuration={400}>
      <WithBackend />
    </TooltipProvider>
  );
}
