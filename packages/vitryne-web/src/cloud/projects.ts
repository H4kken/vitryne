// SPDX-License-Identifier: AGPL-3.0-or-later
// Projects in the cloud, as file-format.md's "Cloud storage" describes: a row holding the manifest,
// and each part an object named by its SHA-256 under the owner's id. A save uploads only the
// parts the backend doesn't have (an avatar shared by every project is stored once per person),
// then writes the row, so an interrupted save leaves the previous manifest whole. An open
// downloads the parts and checks every hash before the worker sees them.

import type { FileData } from "@/worker/protocol";
import {
  type CloudBackend,
  CloudError,
  type Manifest,
  type ProjectRow,
} from "./backend";
import { zipStored } from "./zip";

export const MIMETYPE = "application/vnd.vitryne.project+zip";

/** A project opened from or saved to the cloud: what the next save of it starts from. */
export interface CloudRef {
  id: string;
  revision: number;
  /** Hashes of the parts the backend is known to hold for it. */
  parts: string[];
}

export async function sha256Hex(b: ArrayBuffer | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    b instanceof Uint8Array ? (b.slice() as Uint8Array<ArrayBuffer>) : b,
  );
  return [...new Uint8Array(d)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const dec = (b: ArrayBuffer) => new TextDecoder().decode(b);

interface Part {
  path: string;
  sha256: string;
  mediaType: string;
  bytes: ArrayBuffer;
}

/** The worker's folder form split into its manifest and the parts it lists, every hash checked. */
export async function splitFolder(
  files: [string, ArrayBuffer][],
): Promise<{ manifest: Manifest; parts: Part[]; bytes: number }> {
  const byPath = new Map(files);
  const m = byPath.get("manifest.json");
  if (!m) throw new CloudError("internal: the project has no manifest.json");
  const manifest = JSON.parse(dec(m)) as Manifest;
  if (!Array.isArray(manifest.parts))
    throw new CloudError("internal: the manifest lists no parts");
  const parts: Part[] = [];
  for (const p of manifest.parts) {
    const bytes = byPath.get(p.path);
    if (!bytes)
      throw new CloudError(`internal: ${p.path} is listed but missing`);
    const sha = await sha256Hex(bytes);
    if (p.sha256 !== undefined && p.sha256 !== sha)
      throw new CloudError(`internal: ${p.path} doesn't match its hash`);
    p.sha256 = sha;
    parts.push({
      path: p.path,
      sha256: sha,
      mediaType: p.mediaType ?? "application/octet-stream",
      bytes,
    });
  }
  const listed = new Set([
    "manifest.json",
    "mimetype",
    ...parts.map((p) => p.path),
  ]);
  const extra = files.map(([p]) => p).filter((p) => !listed.has(p));
  if (extra.length)
    throw new CloudError(
      `internal: files the manifest doesn't list: ${extra.join(", ")}`,
    );
  return {
    manifest,
    parts,
    bytes: parts.reduce((s, p) => s + p.bytes.byteLength, 0),
  };
}

export interface SaveProgress {
  done: number;
  total: number;
}

/**
 * Saves the worker's folder form as a new cloud project (`prev` null) or over the one it was
 * opened from. A conflict (saved elsewhere since `prev`) changes nothing and throws.
 */
export async function saveProject(
  b: CloudBackend,
  name: string,
  files: [string, ArrayBuffer][],
  prev: CloudRef | null,
  progress?: (p: SaveProgress) => void,
): Promise<CloudRef> {
  const user = await b.ensureUser();
  const { manifest, parts, bytes } = await splitFolder(files);
  const known = new Set(prev?.parts);
  const todo = [
    ...new Map(
      parts.filter((p) => !known.has(p.sha256)).map((p) => [p.sha256, p]),
    ).values(),
  ];
  let done = 0;
  progress?.({ done, total: todo.length });
  for (const p of todo) {
    const key = `${user.id}/${p.sha256}`;
    if (!(await b.hasPart(key))) await b.uploadPart(key, p.bytes, p.mediaType);
    progress?.({ done: ++done, total: todo.length });
  }
  const row = prev
    ? await b.updateProject(prev.id, prev.revision, { name, manifest, bytes })
    : await b.insertProject({ name, manifest, bytes });
  if (!row) {
    throw new CloudError(
      "this project was saved from another tab or browser since you opened it. Save a copy to the cloud to keep both.",
      "conflict",
    );
  }
  return {
    id: row.id,
    revision: row.revision,
    parts: [...new Set(parts.map((p) => p.sha256))],
  };
}

/** The project's files in the folder form (mimetype and manifest first), every part checked. */
async function folderOf(
  b: CloudBackend,
  row: ProjectRow,
): Promise<[string, ArrayBuffer][]> {
  const files: [string, ArrayBuffer][] = [
    ["mimetype", enc(MIMETYPE)],
    ["manifest.json", enc(JSON.stringify(row.manifest, null, 2))],
  ];
  // All at once: one round trip for the parts, not one each.
  const parts = await Promise.all(
    row.manifest.parts.map(async (p): Promise<[string, ArrayBuffer]> => {
      if (!p.sha256 || !/^[0-9a-f]{64}$/.test(p.sha256))
        throw new CloudError(
          `${p.path} has no hash in the stored manifest`,
          "damaged",
        );
      const bytes = await b.downloadPart(`${row.owner}/${p.sha256}`);
      if ((await sha256Hex(bytes)) !== p.sha256)
        throw new CloudError(
          `${p.path} came back damaged; try again`,
          "damaged",
        );
      return [p.path, bytes];
    }),
  );
  return [...files, ...parts];
}

type Opened = { name: string; ref: CloudRef; data: FileData };

/** How long a project fetched ahead (the pointer over it in a list) waits to be opened. */
const AHEAD_MS = 10_000;
const ahead = new Map<string, { at: number; got: Promise<Opened> }>();

async function fetchProject(b: CloudBackend, id: string): Promise<Opened> {
  const row = await b.getProject(id);
  const files = await folderOf(b, row);
  return {
    name: row.name,
    ref: {
      id: row.id,
      revision: row.revision,
      parts: row.manifest.parts.flatMap((p) => (p.sha256 ? [p.sha256] : [])),
    },
    data: { form: "folder", files },
  };
}

/** Starts downloading a project the person is about to open, so the open finds it here. */
export function fetchAhead(b: CloudBackend, id: string): void {
  const a = ahead.get(id);
  if (a && Date.now() - a.at < AHEAD_MS) return;
  const got = fetchProject(b, id);
  got.catch(() => ahead.delete(id));
  ahead.set(id, { at: Date.now(), got });
}

export async function openProject(
  b: CloudBackend,
  id: string,
): Promise<Opened> {
  const a = ahead.get(id);
  ahead.delete(id);
  // Taken once: a failed fetch ahead is tried again.
  if (a && Date.now() - a.at < AHEAD_MS)
    return a.got.catch(() => fetchProject(b, id));
  return fetchProject(b, id);
}

/** A cloud project as a .vtry file (the parts zipped, mimetype first). */
export async function projectZip(
  b: CloudBackend,
  id: string,
): Promise<{ name: string; bytes: ArrayBuffer }> {
  const row = await b.getProject(id);
  return { name: row.name, bytes: zipStored(await folderOf(b, row)) };
}

/** A file name from a project name, unique within `taken`. */
export function fileName(
  name: string,
  taken: Set<string>,
  ext = ".vtry",
): string {
  const safe = [...name]
    .map((c) => (c < " " || '\\/:*?"<>|'.includes(c) ? "_" : c))
    .join("");
  const base = safe.trim().slice(0, 100) || "project";
  let n = `${base}${ext}`;
  for (let i = 2; taken.has(n); i++) n = `${base} (${i})${ext}`;
  taken.add(n);
  return n;
}

/**
 * Everything stored for the person (GDPR art. 15 and 20): each project as a .vtry, and what the
 * account holds about them.
 */
export async function exportAll(
  b: CloudBackend,
  account: Record<string, unknown>,
): Promise<ArrayBuffer> {
  const taken = new Set<string>();
  const entries: [string, ArrayBuffer][] = [];
  const list = await b.listProjects();
  for (const p of list) {
    const z = await projectZip(b, p.id);
    entries.push([`projects/${fileName(p.name, taken)}`, z.bytes]);
  }
  const about = {
    ...account,
    exportedAt: new Date().toISOString(),
    projects: list,
  };
  entries.unshift(["account.json", enc(JSON.stringify(about, null, 2))]);
  return zipStored(entries);
}

/** Deletes the parts no project uses any more. Best effort: a failure leaves them for later. */
export async function collectUnused(b: CloudBackend): Promise<number> {
  const unused = await b.unusedParts();
  for (let i = 0; i < unused.length; i += 500)
    await b.removeParts(unused.slice(i, i + 500));
  return unused.length;
}

/** A project's copy name, within the 200 characters the backend allows. */
export function copyName(name: string): string {
  const suffix = " (copy)";
  return [...name].slice(0, 200 - suffix.length).join("") + suffix;
}

/**
 * `row`'s manifest and size with its name changed. The name is in project.json, so that part is
 * written again (a few hundred bytes); every other part stays as it is.
 */
async function renamed(
  b: CloudBackend,
  row: ProjectRow,
  name: string,
): Promise<{ manifest: Manifest; bytes: number }> {
  const manifest = structuredClone(row.manifest);
  let bytes = row.bytes;
  const part = manifest.parts.find((p) => p.path === "project.json");
  if (part?.sha256) {
    const old = await b.downloadPart(`${row.owner}/${part.sha256}`);
    if ((await sha256Hex(old)) !== part.sha256)
      throw new CloudError(
        "project.json came back damaged; try again",
        "damaged",
      );
    const project = JSON.parse(dec(old)) as Record<string, unknown>;
    project.name = name;
    const next = enc(`${JSON.stringify(project, null, 2)}\n`);
    const sha = await sha256Hex(next);
    const key = `${row.owner}/${sha}`;
    if (!(await b.hasPart(key)))
      await b.uploadPart(key, next, part.mediaType ?? "application/json");
    part.sha256 = sha;
    bytes += next.byteLength - old.byteLength;
  }
  return { manifest, bytes };
}

/**
 * A new project with the same content as `id`, named "<name> (copy)"; every part but
 * project.json is shared, so almost nothing is uploaded. An anonymous user can't (one draft).
 */
export async function duplicateProject(
  b: CloudBackend,
  id: string,
): Promise<ProjectRow> {
  const row = await b.getProject(id);
  const name = copyName(row.name);
  // Same owner: the thumbnail's part is shared like the others.
  return b.insertProject({
    name,
    ...(await renamed(b, row, name)),
    thumbnail: row.thumbnail,
  });
}

/** Renames a project that isn't open here (a tab that has it open sees a conflict at its next save). */
export async function renameProject(
  b: CloudBackend,
  id: string,
  name: string,
): Promise<void> {
  const row = await b.getProject(id);
  if (name === row.name) return;
  const saved = await b.updateProject(id, row.revision, {
    name,
    ...(await renamed(b, row, name)),
  });
  if (!saved)
    throw new CloudError(
      "it was saved elsewhere meanwhile; try again",
      "conflict",
    );
}

/** Deletes a project; its parts go with the next collection (they may be shared). */
export async function deleteProject(
  b: CloudBackend,
  id: string,
): Promise<void> {
  await b.deleteProject(id);
}

/** Deletes every part, then the account and its projects (GDPR art. 17). */
export async function deleteAccount(b: CloudBackend): Promise<void> {
  for (;;) {
    const parts = await b.listParts();
    if (!parts.length) break;
    for (let i = 0; i < parts.length; i += 500)
      await b.removeParts(parts.slice(i, i + 500));
  }
  await b.deleteUser();
}

/**
 * Moves every project of `from` (an anonymous user, before they signed in to an existing
 * account) to `to`, then deletes `from`. A project that fails stays with `from`, which is kept.
 * `ids`: each moved project's new id, by its old one (an open project follows it).
 */
export async function moveProjects(
  from: CloudBackend,
  to: CloudBackend,
): Promise<{ moved: number; failed: string[]; ids: Record<string, string> }> {
  const failed: string[] = [];
  const ids: Record<string, string> = {};
  for (const p of await from.listProjects()) {
    try {
      const o = await openProject(from, p.id);
      if (o.data.form !== "folder") throw new Error("internal");
      const moved = await saveProject(to, o.name, o.data.files, null);
      ids[p.id] = moved.id;
      if (p.thumbnail)
        await copyThumbnail(from, to, p.thumbnail, moved.id).catch(
          () => undefined,
        );
      await from.deleteProject(p.id);
    } catch {
      failed.push(p.name);
    }
  }
  if (!failed.length) await deleteAccount(from);
  return { moved: Object.keys(ids).length, failed, ids };
}

/** A thumbnail moved with its project (best effort: the next drape makes another). */
async function copyThumbnail(
  from: CloudBackend,
  to: CloudBackend,
  sha: string,
  id: string,
): Promise<void> {
  const bytes = await from.downloadPart(`${from.user()?.id}/${sha}`);
  const owner = to.user()?.id;
  if (!owner) return;
  if (!(await to.hasPart(`${owner}/${sha}`)))
    await to.uploadPart(`${owner}/${sha}`, bytes, "application/octet-stream");
  await to.setThumbnail(id, sha);
}

/**
 * Stores `image` as project `id`'s thumbnail: uploaded once (a part named by its hash), then
 * named by the row. Not an edit of the project. Returns the hash.
 */
export async function saveThumbnail(
  b: CloudBackend,
  id: string,
  image: ArrayBuffer,
  type: string,
): Promise<string> {
  const owner = b.user()?.id;
  if (!owner) throw new CloudError("not signed in", "auth");
  const sha = await sha256Hex(image);
  const key = `${owner}/${sha}`;
  if (!(await b.hasPart(key))) await b.uploadPart(key, image, type);
  await b.setThumbnail(id, sha);
  return sha;
}

const thumbnails = new Map<string, Promise<string>>();

/** A thumbnail as an object URL for an <img>, downloaded once per page (a hash never changes). */
export function thumbnailUrl(b: CloudBackend, sha: string): Promise<string> {
  let url = thumbnails.get(sha);
  if (!url) {
    url = b
      .downloadPart(`${b.user()?.id}/${sha}`)
      .then((bytes) => URL.createObjectURL(new Blob([bytes])));
    url.catch(() => thumbnails.delete(sha));
    thumbnails.set(sha, url);
  }
  return url;
}
