// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { NoticeCard } from "./NoticeCard";

/** How long a plain notice stays, ms. Errors and questions stay until dismissed. */
const STAYS = 6000;
/** Longer for a longer message: it has to be read, ms per character. */
const PER_CHAR = 40;

/** A passing message, bottom centre above the tool bar; it goes away by itself. */
export function InfoToast(props: { text: string; onDismiss: () => void }) {
  const { text, onDismiss } = props;
  useEffect(() => {
    const t = setTimeout(onDismiss, STAYS + PER_CHAR * text.length);
    return () => clearTimeout(t);
  }, [text, onDismiss]);
  // On the page itself: inside a view it would sit under the splitter between the views.
  return createPortal(
    <div className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2">
      <NoticeCard onDismiss={onDismiss}>{text}</NoticeCard>
    </div>,
    document.body,
  );
}
