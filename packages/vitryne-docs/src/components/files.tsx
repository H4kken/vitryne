// SPDX-License-Identifier: AGPL-3.0-or-later
// Fumadocs' file tree entries with an optional note after the name:
// `<Folder name="vitryne-docs" note="this documentation" />`. Astro's MDX can't pass JSX as a
// prop to a React component (it arrives as an Astro object React can't render), so the note is
// a string and the markup is made here. `Files` itself is Fumadocs' own.
import {
  File as FumadocsFile,
  Folder as FumadocsFolder,
  type FileProps,
  type FolderProps,
} from "fumadocs-ui/components/files";

/** The name and its note, as the node Fumadocs renders after an entry's icon. */
function label(name: string, note?: string) {
  if (!note) return name;
  return (
    <>
      {name}
      <span className="ms-2 text-fd-muted-foreground">← {note}</span>
    </>
  );
}

// Fumadocs types `name` as a string but renders it as content, so a node works.
const named = (name: string, note?: string) =>
  label(name, note) as unknown as string;

export function Folder({
  name,
  note,
  ...props
}: FolderProps & { note?: string }) {
  return <FumadocsFolder name={named(name, note)} {...props} />;
}

export function File({ name, note, ...props }: FileProps & { note?: string }) {
  return <FumadocsFile name={named(name, note)} {...props} />;
}
