// SPDX-License-Identifier: AGPL-3.0-or-later
// What the cloud side of the editor needs from a backend (docs/CLOUD.md). `supabase.ts` is the
// real one; tests use an in-memory one. Parts are named `<owner id>/<sha256>`.

export interface CloudUser {
  id: string;
  /** Null for an anonymous user (no email yet). */
  email: string | null;
  anonymous: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  bytes: number;
  revision: number;
  updatedAt: string;
  /** The sha256 of the project's thumbnail (a part of the owner's), if it has one. */
  thumbnail: string | null;
}

export interface ProjectRow extends ProjectSummary {
  owner: string;
  manifest: Manifest;
}

export interface ManifestPart {
  path: string;
  mediaType?: string;
  sha256?: string;
  role?: string;
}

export interface Manifest {
  parts: ManifestPart[];
  [k: string]: unknown;
}

export interface Usage {
  usedBytes: number;
  quotaBytes: number;
  projects: number;
  maxProjects: number;
}

export interface CloudBackend {
  user(): CloudUser | null;
  /** The signed-in user, after creating an anonymous one if there is none. */
  ensureUser(): Promise<CloudUser>;

  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<ProjectRow>;
  insertProject(p: { name: string; manifest: Manifest; bytes: number; thumbnail?: string | null }): Promise<ProjectRow>;
  /** Null when the project is no longer at `revision` (saved elsewhere since) or is gone. */
  updateProject(id: string, revision: number, p: { name: string; manifest: Manifest; bytes: number }): Promise<ProjectRow | null>;
  deleteProject(id: string): Promise<void>;
  /** Names the project's thumbnail (a part already uploaded); not an edit: the revision stays. */
  setThumbnail(id: string, sha256: string): Promise<void>;

  hasPart(name: string): Promise<boolean>;
  /** Succeeds when the part is already there (parts never change). */
  uploadPart(name: string, bytes: ArrayBuffer, mediaType: string): Promise<void>;
  downloadPart(name: string): Promise<ArrayBuffer>;
  /** Every part of the signed-in user. */
  listParts(): Promise<string[]>;
  removeParts(names: string[]): Promise<void>;
  /** Parts no project uses any more, older than a day. */
  unusedParts(): Promise<string[]>;
  usage(): Promise<Usage>;

  /** Removes the user (and their projects); their parts must be gone already. */
  deleteUser(): Promise<void>;
}

/**
 * Something the person can act on: a quota, a conflict, a network failure, a refusal. `account`:
 * an anonymous user tried what needs an account (a second project).
 */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: 'conflict' | 'quota' | 'account' | 'damaged' | 'auth' | 'other' = 'other',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CloudError';
  }
}
