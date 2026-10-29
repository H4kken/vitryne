// SPDX-License-Identifier: AGPL-3.0-or-later
// The backend by configuration (docs/CLOUD.md): a `config.json` next to index.html names it, so
// one build serves every instance and self-hosters never rebuild. Without one the editor says so
// and stops (projects are saved to the backend).

/** Where the cloud session is kept (localStorage), once the person used a cloud feature. */
export const SESSION_KEY = "vitryne-cloud-session";

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
  return q.has("code") || q.has("error") || h.has("error");
}

export interface CloudConfig {
  /** The backend's base URL (Auth at /auth/v1, the REST API at /rest/v1, Storage at /storage/v1). */
  url: string;
  /** The project's publishable key; it identifies the project, it grants nothing on its own. */
  publishableKey: string;
  /** Where the instance's privacy policy is. */
  privacyPolicy: string | null;
  /** Where the instance's terms of service are, if it has any. */
  termsOfService: string | null;
}

/** Null when there is no usable config.json. */
export function parseConfig(text: string, base: string): CloudConfig | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const b = (
    j as { backend?: { url?: unknown; publishableKey?: unknown } } | null
  )?.backend;
  if (
    !b ||
    typeof b.url !== "string" ||
    typeof b.publishableKey !== "string" ||
    !b.url ||
    !b.publishableKey
  )
    return null;
  const p = (j as { privacyPolicy?: unknown }).privacyPolicy;
  const t = (j as { termsOfService?: unknown }).termsOfService;
  const link = (v: unknown) =>
    typeof v === "string" && v ? new URL(v, base).href : null;
  return {
    url: new URL(b.url, base).href.replace(/\/$/, ""),
    publishableKey: b.publishableKey,
    privacyPolicy: link(p),
    termsOfService: link(t),
  };
}

export async function loadConfig(): Promise<CloudConfig | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}config.json`, {
      cache: "no-cache",
    });
    // A static host without the file may answer with index.html: not JSON, so no backend.
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json"))
      return null;
    return parseConfig(await r.text(), location.href);
  } catch {
    return null;
  }
}
