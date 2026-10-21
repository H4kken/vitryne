// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";

export function useDraft(value: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    text: draft ?? value,
    editing: draft !== null,
    setDraft,
    clear: () => setDraft(null),
  };
}
