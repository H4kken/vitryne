// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { type Example, listExamples } from "../examples";

/** The bundled examples (null until listed), and why they couldn't be listed. */
export function useExamples() {
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listExamples().then(setExamples, (e: Error) => setError(e.message));
  }, []);
  return { examples, error, dismissError: () => setError(null) };
}
