// SPDX-License-Identifier: AGPL-3.0-or-later
// `/example/$name`: a bundled example, not saved until it is changed (an anonymous user's draft
// isn't replaced by just looking). Its first save moves the URL to `/design/$id`.

import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { exampleId, fetchExample } from "@/editor/examples";
import { useEditor } from "@/editor/hooks/useEditor";
import { ProjectError } from "./ProjectError";
import { ProjectLoading } from "./ProjectLoading";
import { useShowOpen } from "./useShowOpen";

export function ExampleRoute() {
  const { name } = useParams({ from: "/example/$name" });
  const { files, ready, examples, examplesError } = useEditor();
  const navigate = useNavigate();
  const showOpen = useShowOpen();
  const example = examples?.find((e) => exampleId(e) === name) ?? null;
  const openName = files.ref?.cloud ? null : (files.ref?.example ?? null);

  const open = () => {
    if (!example) return;
    void files.openExample(
      name,
      example.file.split("/").pop() ?? example.file,
      () => fetchExample(example),
      showOpen,
    );
  };
  const now = useRef({ open, openName });
  useEffect(() => {
    now.current = { open, openName };
  });
  // Once per example (StrictMode runs effects twice).
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !example || handled.current === name) return;
    handled.current = name;
    if (now.current.openName !== name) now.current.open();
  }, [ready, example, name]);

  const failed =
    files.openError?.key === `example:${name}`
      ? files.openError.message
      : (examplesError ??
        (examples && !example
          ? `There is no example called “${name}”.`
          : null));
  if (failed)
    return (
      <ProjectError
        title="Can't open this example"
        hint="The examples come with this Vitryne; this one couldn't be loaded."
        detail={failed}
        onRetry={open}
        onHome={() => void navigate({ to: "/" })}
      />
    );
  if (openName !== name)
    return <ProjectLoading text={files.busy ?? "Opening the example"} />;
  return null;
}
