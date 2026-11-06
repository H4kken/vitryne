// SPDX-License-Identifier: AGPL-3.0-or-later
// The bodies the Avatar panel offers (`vitryne export-app-assets`: bodies/index.json, and
// bodies/<slug>/{avatar.json,body.glb} fetched when one is picked).

export interface BodyOption {
  slug: string;
  /** The avatar's id, to tell which one the project has. */
  id: string;
  name: string;
  /** Tape measures, mm. */
  height: number;
  chest: number;
  waist: number;
  hips: number;
}

export async function listBodies(): Promise<BodyOption[]> {
  const r = await fetch(`${import.meta.env.BASE_URL}bodies/index.json`);
  if (!r.ok) throw new Error("the bodies are missing (run `pnpm run assets`)");
  return (await r.json()) as BodyOption[];
}

/** A body's avatar file (JSON text) and its mesh (glTF binary). */
export async function fetchBody(
  slug: string,
): Promise<{ avatar: string; glb: ArrayBuffer }> {
  const base = `${import.meta.env.BASE_URL}bodies/${slug}`;
  const [a, g] = await Promise.all([
    fetch(`${base}/avatar.json`),
    fetch(`${base}/body.glb`),
  ]);
  if (!a.ok || !g.ok) throw new Error(`the body ${slug} could not be loaded`);
  return { avatar: await a.text(), glb: await g.arrayBuffer() };
}
