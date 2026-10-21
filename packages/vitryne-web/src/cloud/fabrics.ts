// SPDX-License-Identifier: AGPL-3.0-or-later
// The fabrics of the person's other projects, to copy into the one open (the Fabric panel's
// "From my projects"). Read from the stored manifests: only the fabric and appearance parts
// are downloaded (half a kilobyte each), every hash checked, the same part once.

import type { Appearance, Fabric } from "@/format/schema.gen";
import type { FabricSource } from "@/document/commands";
import { schemaErrors } from "@/document/validate";
import { type CloudBackend, CloudError } from "./backend";
import { sha256Hex } from "./projects";

/** A fabric found in another project, with that project's name. */
export interface ProjectFabric extends FabricSource {
  projectName: string;
}

/** Parts already fetched, by name: they never change. */
const fetched = new Map<string, Promise<unknown>>();

function partJson(
  b: CloudBackend,
  name: string,
  sha: string,
): Promise<unknown> {
  let got = fetched.get(name);
  if (!got) {
    got = b.downloadPart(name).then(async (bytes) => {
      if ((await sha256Hex(bytes)) !== sha)
        throw new CloudError(
          "a fabric came back damaged; try again",
          "damaged",
        );
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    });
    got.catch(() => fetched.delete(name));
    fetched.set(name, got);
  }
  return got;
}

/** What makes two fabrics the same to the person: everything but ids and where they came from. */
export function fabricKey(f: Fabric, color: string | undefined): string {
  const rest: Partial<Fabric> = { ...f };
  delete rest.id;
  delete rest.libraryRef;
  delete rest.appearance;
  return JSON.stringify([rest, color ?? null]);
}

/**
 * The fabrics of every project but `except`, newest project first, each one once (the first
 * project that has it), leaving out those `except` already has (`have`: their `fabricKey`s).
 * A fabric this editor can't read (a newer file's) is left out.
 */
export async function projectFabrics(
  b: CloudBackend,
  except: string | null,
  have: ReadonlySet<string>,
): Promise<ProjectFabric[]> {
  const projects = (await b.listProjects()).filter((p) => p.id !== except);
  const rows = await Promise.all(projects.map((p) => b.getProject(p.id)));
  const perProject = await Promise.all(
    rows.map(async (row) => {
      const parts = row.manifest.parts.flatMap((p) =>
        /^(fabrics|appearances)\/[^/]+\.json$/.test(p.path) &&
        p.sha256 !== undefined &&
        /^[0-9a-f]{64}$/.test(p.sha256)
          ? [{ path: p.path, sha: p.sha256 }]
          : [],
      );
      const json = await Promise.all(
        parts.map(
          async (p) =>
            [
              p.path,
              await partJson(b, `${row.owner}/${p.sha}`, p.sha),
            ] as const,
        ),
      );
      const looks = new Map<string, Appearance>();
      const fabrics: Fabric[] = [];
      for (const [path, v] of json) {
        if (path.startsWith("appearances/")) {
          if (schemaErrors("appearance", v).length === 0) {
            const a = v as Appearance;
            looks.set(a.id, a);
          }
        } else if (schemaErrors("fabric", v).length === 0)
          fabrics.push(v as Fabric);
      }
      return fabrics.map((fabric): ProjectFabric => ({
        library: row.id,
        projectName: row.name,
        fabric,
        appearance:
          fabric.appearance === undefined
            ? undefined
            : looks.get(fabric.appearance),
      }));
    }),
  );
  const seen = new Set(have);
  const out: ProjectFabric[] = [];
  for (const f of perProject.flat()) {
    const key = fabricKey(f.fabric, f.appearance?.color);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
