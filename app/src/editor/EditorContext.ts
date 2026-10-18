// SPDX-License-Identifier: AGPL-3.0-or-later
// What the editor layout gives the route below it (src/routes/): the open document, opening and
// closing, and the start screen's content.

import { createContext, type ReactNode } from "react";
import type { DocState } from "@/document/store";
import type { Example } from "./examples";
import type { useFiles } from "./hooks/useFiles";

export interface EditorRoutes {
  files: ReturnType<typeof useFiles>;
  doc: DocState;
  /** What a crash left was put back (or offered): a URL can be acted on. */
  ready: boolean;
  /** The bundled examples, once listed. */
  examples: Example[] | null;
  examplesError: string | null;
  /** The start screen, as the layout builds it (`/` shows it). */
  startScreen: ReactNode;
}

export const EditorContext = createContext<EditorRoutes | null>(null);
