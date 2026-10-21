// SPDX-License-Identifier: AGPL-3.0-or-later
import { useContext } from "react";
import { EditorContext, type EditorRoutes } from "../EditorContext";

/** The editor layout's context, for the routes (src/routes/). */
export function useEditor(): EditorRoutes {
  const e = useContext(EditorContext);
  if (!e) throw new Error("internal: a route outside the editor layout");
  return e;
}
