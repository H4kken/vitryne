// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { useFiles } from "../hooks/useFiles";

/** Changes a crash or a closed tab left, offered back (the start screen shows it too). */
export function RecoveryBanner({
  recovery,
}: {
  recovery: NonNullable<ReturnType<typeof useFiles>["recovery"]>;
}) {
  return (
    <div
      className="mx-auto mt-2 flex w-[calc(100%-64px)] max-w-[1056px] flex-wrap items-center gap-3 rounded-2xl border border-[#E1E4DE] bg-white px-5 py-3 text-[15px]"
      role="status"
    >
      <span className="grow">
        Unsaved changes to <strong>{recovery.fileName}</strong> from{" "}
        {new Date(recovery.at).toLocaleString()} were kept in this browser.
      </span>
      <Button onClick={() => void recovery.recover()}>Recover</Button>
      <Button variant="ghost" onClick={() => recovery.discard()}>
        Discard
      </Button>
    </div>
  );
}
