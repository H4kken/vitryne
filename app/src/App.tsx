// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCloud } from "./cloud/useCloud";
import { Editor } from "./editor/Editor";
import { Logo } from "./editor/icons";
import { checkWebGpu, type GpuCheck, SUPPORTED_BROWSERS } from "./webgpu";

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

/** The editor, once the instance's backend is known (projects are saved there). */
function WithBackend() {
  const cloud = useCloud();
  if (cloud === undefined) return null;
  if (cloud === null) return <NoBackend />;
  return <Editor cloud={cloud} />;
}

function NoBackend() {
  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-8 pt-14">
        <h1 className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em]">
          This Vitryne has no backend
        </h1>
        <p className="text-body-text m-0 text-[19px] leading-normal">
          Projects are saved to a backend, and this instance doesn't name one:
          its <code>config.json</code> is missing or incomplete.
        </p>
        <p className="text-body-text m-0 text-[17px] leading-normal">
          If you run it, set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_PUBLISHABLE_KEY</code> (docs/CLOUD.md). In development,
          start it with <code>pnpm run dev</code>, which starts the local
          backend too.
        </p>
      </div>
    </main>
  );
}

function NoWebGpu({ reason }: { reason: string }) {
  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-8 pt-14">
        <h1 className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em]">
          This browser can't show the 3D view
        </h1>
        <p className="text-body-text m-0 text-[19px] leading-normal">
          {reason}
        </p>
        <p className="text-body-text m-0 text-[17px] leading-normal">
          Vitryne works in {SUPPORTED_BROWSERS}, on a device with a GPU those
          browsers can use: the 3D view runs in your browser.
        </p>
      </div>
    </main>
  );
}
