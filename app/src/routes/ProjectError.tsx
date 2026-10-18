// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { Logo } from "@/editor/icons";

/** At a URL whose project or example couldn't be opened: why, and where to go from there. */
export function ProjectError(props: {
  title: string;
  /** What is likely wrong, in plain words. */
  hint: string;
  /** The error itself. */
  detail: string;
  onRetry: () => void;
  onHome: () => void;
}) {
  return (
    <div className="bg-background absolute inset-0 z-30 flex flex-col overflow-y-auto">
      <div className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
      </div>
      <div
        role="alert"
        className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-8 pt-14"
      >
        <h1 className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em]">
          {props.title}
        </h1>
        <p className="text-body-text m-0 text-[19px] leading-normal">
          {props.hint}
        </p>
        <p className="text-muted-foreground m-0 text-[15px]">{props.detail}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={props.onHome}>Your projects</Button>
          <Button variant="outline" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
