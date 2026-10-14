// SPDX-License-Identifier: AGPL-3.0-or-later
// Cloud mode by configuration (docs/CLOUD.md): a `config.json` next to index.html names a
// backend. Without one the editor is local only: no accounts, and no network calls beyond the
// app and its assets. One build serves both, so self-hosters never rebuild.

/** Where the cloud session is kept (localStorage), once the person used a cloud feature. */
export const SESSION_KEY = 'vitryne-cloud-session';

/** A session from an earlier visit (checked without loading the cloud code). */
export function hasSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/** A Google sign-in coming back (a code or an error in the URL): connect at once to finish it. */
export function returningFromSignIn(): boolean {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  return q.has('code') || q.has('error') || h.has('error');
}

export interface CloudConfig {
  /** The backend's base URL (Auth at /auth/v1, the REST API at /rest/v1, Storage at /storage/v1). */
  url: string;
  /** The project's publishable key; it identifies the project, it grants nothing on its own. */
  publishableKey: string;
  /** Where the instance's privacy policy is. */
  privacyPolicy: string | null;
}

/** Null when there is no usable config.json: local mode. */
export function parseConfig(text: string, base: string): CloudConfig | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const b = (j as { backend?: { url?: unknown; publishableKey?: unknown } } | null)?.backend;
  if (!b || typeof b.url !== 'string' || typeof b.publishableKey !== 'string' || !b.url || !b.publishableKey) return null;
  const p = (j as { privacyPolicy?: unknown }).privacyPolicy;
  return {
    url: new URL(b.url, base).href.replace(/\/$/, ''),
    publishableKey: b.publishableKey,
    privacyPolicy: typeof p === 'string' && p ? new URL(p, base).href : null,
  };
}

export async function loadConfig(): Promise<CloudConfig | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' });
    // A static host without the file may answer with index.html: not JSON, so local mode.
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return parseConfig(await r.text(), location.href);
  } catch {
    return null;
  }
}
