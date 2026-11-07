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

/** How the panel lays the bodies out: the first avatar on its own, then the rest by sex, slim to
 *  fuller. Read from the slug (`female-slim`); a body whose slug doesn't fit goes under "Other". */
export interface BodyGroups {
  original: BodyOption | undefined;
  groups: { label: string; items: { body: BodyOption; label: string }[] }[];
}

const BUILDS = ["slim", "average", "full"] as const;
const BUILD_LABEL: Record<(typeof BUILDS)[number], string> = {
  slim: "Slim",
  average: "Average",
  full: "Fuller",
};

export function groupBodies(bodies: BodyOption[]): BodyGroups {
  const original = bodies.find((b) => b.slug === "default");
  const groups: BodyGroups["groups"] = [];
  const add = (label: string, body: BodyOption, item: string) => {
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push({ body, label: item });
  };
  for (const sex of ["female", "male"]) {
    for (const build of BUILDS) {
      const body = bodies.find((b) => b.slug === `${sex}-${build}`);
      if (body)
        add(sex === "female" ? "Female" : "Male", body, BUILD_LABEL[build]);
    }
  }
  for (const b of bodies) {
    if (b === original || groups.some((g) => g.items.some((i) => i.body === b)))
      continue;
    add("Other", b, b.name);
  }
  return { original, groups };
}
