// SPDX-License-Identifier: AGPL-3.0-or-later
// The sample projects bundled with the app (`drape export-app-assets`).

export interface Example {
  file: string;
  title: string;
  sdfKey: string;
}

export async function listExamples(): Promise<Example[]> {
  const r = await fetch(`${import.meta.env.BASE_URL}examples/index.json`);
  if (!r.ok) throw new Error('the examples are missing (run `pnpm run assets`)');
  return (await r.json()) as Example[];
}

const fetched = new Map<string, Promise<ArrayBuffer>>();

/** An example's file, downloaded once per page (`fetchExample` early: pointing at it). */
export async function fetchExample(e: Example): Promise<ArrayBuffer> {
  let got = fetched.get(e.file);
  if (!got) {
    got = fetch(`${import.meta.env.BASE_URL}${e.file}`).then((r) => {
      if (!r.ok) throw new Error(`${e.file}: ${r.status} ${r.statusText}`);
      return r.arrayBuffer();
    });
    got.catch(() => fetched.delete(e.file));
    fetched.set(e.file, got);
  }
  // A copy each time: an open may hand its bytes on.
  return (await got).slice(0);
}

/** The test avatar's mesh (glTF binary), which projects made from an imported pattern use. */
export async function fetchAvatar(): Promise<ArrayBuffer> {
  const r = await fetch(`${import.meta.env.BASE_URL}avatar/body.glb`);
  if (!r.ok) throw new Error('the avatar is missing (run `pnpm run assets`)');
  return r.arrayBuffer();
}
