// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCloud } from "@/cloud/useCloud";
import { EditorLayout } from "@/editor/layout/EditorLayout";
import { NoBackend } from "./NoBackend";

/** The editor, once the instance's backend is known (projects are saved there). */
export function WithBackend() {
  const cloud = useCloud();
  if (cloud === undefined) return null;
  if (cloud === null) return <NoBackend />;
  return <EditorLayout cloud={cloud} />;
}
