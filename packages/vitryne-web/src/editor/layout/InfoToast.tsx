// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { NoticeCard } from "./NoticeCard";

/** How long a plain notice stays, ms. Errors and questions stay until dismissed. */
const STAYS = 6000;

/** A passing message, bottom centre above the tool bar; it goes away by itself. */
export function InfoToast(props: { text: string; onDismiss: () => void }) {
  const { text, onDismiss } = props;
  useEffect(() => {
    const t = setTimeout(onDismiss, STAYS);
    return () => clearTimeout(t);
  }, [text, onDismiss]);
  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
      <NoticeCard onDismiss={onDismiss}>{text}</NoticeCard>
    </div>
  );
}
