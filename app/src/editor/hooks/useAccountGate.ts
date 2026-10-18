// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";

/**
 * The account dialog, and what waits for an account: `need` runs an action at once with an
 * account, or opens the dialog (saying why) and runs it once one is created or signed in to.
 */
export function useAccountGate(isAccount: boolean) {
  const [open, setOpen] = useState(false);
  /** Why the account dialog was opened, and what to do once there is an account. */
  const [reason, setReason] = useState<string | null>(null);
  const after = useRef<(() => void) | null>(null);
  /** Runs `then` with an account: at once, or once one is created or signed in to. */
  const need = (why: string, then: () => void) => {
    if (isAccount) return then();
    after.current = then;
    setReason(why);
    setOpen(true);
  };
  useEffect(() => {
    if (!isAccount || !after.current) return;
    const then = after.current;
    after.current = null;
    setOpen(false);
    setReason(null);
    then();
  }, [isAccount]);
  /** The dialog closed without an account: nothing waits any more. */
  const dismiss = () => {
    setOpen(false);
    setReason(null);
    after.current = null;
  };
  return { open, setOpen, reason, need, dismiss };
}
