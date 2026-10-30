// SPDX-License-Identifier: AGPL-3.0-or-later
// The backend on Supabase (packages/vitryne-cloud/deploy/, packages/vitryne-docs/content/docs/developers/cloud.md). Loaded with a dynamic import once the person
// saves or opens a project or their account (or has a session from an earlier visit), so trying
// an example doesn't download it. The session is kept in localStorage: it is what the
// requested feature needs, nothing else is stored.

import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  type CloudBackend,
  CloudError,
  type CloudUser,
  type Manifest,
  type ProjectRow,
  type ProjectSummary,
  type Usage,
} from "./backend";
import { type CloudConfig, SESSION_KEY } from "./config";

const BUCKET = "parts";
/** sessionStorage: what to do when a Google sign-in comes back. */
const RETURN_KEY = "vitryne-google-return";

/** Saved before leaving for Google: the cloud project to reopen, the anonymous session left. */
export interface Stash {
  reopen?: string;
  from?: { token: string; user: CloudUser };
}

/** A Google redirect's result in the URL: its error if any, and the URL without it. */
function readReturn(): {
  error: { code: string; message: string } | null;
  clean: string;
} | null {
  const u = new URL(location.href);
  const hash = new URLSearchParams(u.hash.slice(1));
  const get = (k: string) => u.searchParams.get(k) ?? hash.get(k);
  if (!get("code") && !get("error")) return null;
  const error = get("error")
    ? {
        code: get("error_code") ?? get("error") ?? "error",
        message: get("error_description") ?? "sign-in failed",
      }
    : null;
  for (const k of ["code", "error", "error_code", "error_description", "state"])
    u.searchParams.delete(k);
  return { error, clean: u.pathname + u.search };
}

/**
 * A password reset link's session in the URL (implicit flow, so the link works on any device),
 * taken out of it before Auth's client sees it.
 */
function readRecovery(): {
  access_token: string;
  refresh_token: string;
} | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (hash.get("type") !== "recovery" || !access_token || !refresh_token)
    return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  return { access_token, refresh_token };
}

interface Row {
  id: string;
  owner: string;
  name: string;
  manifest: Manifest;
  bytes: number;
  revision: number;
  updated_at: string;
  thumbnail: string | null;
}

/** The picture Google shares, only if it is an https address. A user linked to Google from an anonymous one has it on the identity, not in `user_metadata`. */
const avatarOf = (u: User): string | null => {
  const sources = [
    u.user_metadata,
    ...(u.identities ?? [])
      .filter((i) => i.provider === "google")
      .map((i) => i.identity_data),
  ] as ({ avatar_url?: unknown; picture?: unknown } | null | undefined)[];
  for (const m of sources) {
    const v = m?.avatar_url ?? m?.picture;
    if (typeof v === "string" && v.startsWith("https://")) return v;
  }
  return null;
};
const toUser = (u: User): CloudUser => ({
  id: u.id,
  email: u.email || null,
  anonymous: u.is_anonymous ?? !u.email,
  avatarUrl: avatarOf(u),
});
const summary = (r: Row): ProjectSummary => ({
  id: r.id,
  name: r.name,
  bytes: r.bytes,
  revision: r.revision,
  updatedAt: r.updated_at,
  thumbnail: r.thumbnail ?? null,
});
const full = (r: Row): ProjectRow => ({
  ...summary(r),
  owner: r.owner,
  manifest: r.manifest,
});

function fail(
  what: string,
  e: {
    message?: string;
    hint?: string | null;
    status?: number;
    statusCode?: string;
  } | null,
): never {
  const msg = e?.message ?? "unknown error";
  if (e?.hint === "account")
    throw new CloudError(
      `${what}: create a free account to keep more than one project`,
      "account",
    );
  if (e?.hint === "quota" || /project limit/.test(msg))
    throw new CloudError(
      `${what}: you have reached the number of projects this instance allows`,
      "quota",
    );
  if (/JWT|not signed in|401/.test(msg) || e?.status === 401)
    throw new CloudError(`${what}: you are signed out; sign in again`, "auth");
  throw new CloudError(`${what}: ${msg}`);
}

export class SupabaseBackend implements CloudBackend {
  private current: CloudUser | null = null;
  private listeners = new Set<(u: CloudUser | null) => void>();

  private constructor(
    readonly sb: SupabaseClient,
    private readonly config: CloudConfig,
  ) {}

  /** This page load is a Google sign-in coming back. */
  returned = false;
  /** Set when a Google redirect came back with an error (e.g. that account already exists). */
  returnError: { code: string; message: string } | null = null;
  /**
   * This page load is a password reset link: signed in to the account, a new password to choose
   * (`setPassword`). `from`: the anonymous user this browser had, whose projects move to it.
   */
  recovery: { from: SupabaseBackend | null } | null = null;

  /**
   * The person's backend, with the session from an earlier visit if there is one, or the one a
   * Google redirect just brought back (PKCE: the code in the URL is exchanged, then removed).
   */
  static async connect(config: CloudConfig): Promise<SupabaseBackend> {
    const recovery = readRecovery();
    const back = readReturn();
    const sb = createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: SESSION_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    const b = new SupabaseBackend(sb, config);
    const { data } = await sb.auth.getSession();
    b.setSession(data.session);
    sb.auth.onAuthStateChange((_event, session) => b.setSession(session));
    if (recovery) {
      const from = b.current?.anonymous ? b.detached() : null;
      const r = await sb.auth.setSession(recovery);
      if (r.error) {
        b.returned = true;
        b.returnError = {
          code: r.error.code ?? "recovery",
          message: "That link did not work: ask for a new one",
        };
      } else {
        b.setSession(r.data.session);
        b.recovery = { from };
      }
    }
    if (back) {
      b.returned = true;
      b.returnError = back.error;
      history.replaceState(history.state, "", back.clean);
    }
    return b;
  }

  /** A backend on a given session that nothing replaces: what `moveProjects` reads from. */
  static frozen(
    config: CloudConfig,
    token: string,
    user: CloudUser,
  ): SupabaseBackend {
    const sb = createClient(config.url, config.publishableKey, {
      accessToken: async () => token,
    });
    const b = new SupabaseBackend(sb, config);
    b.current = user;
    return b;
  }

  /** The current session, frozen: signing in to another account doesn't replace it. */
  detached(): SupabaseBackend | null {
    const user = this.current;
    const token = this.lastSession?.access_token;
    return user && token
      ? SupabaseBackend.frozen(this.config, token, user)
      : null;
  }

  private lastSession: Session | null = null;

  private setSession(s: Session | null) {
    this.lastSession = s;
    const u = s?.user ? toUser(s.user) : null;
    if (
      u?.id === this.current?.id &&
      u?.email === this.current?.email &&
      u?.anonymous === this.current?.anonymous
    )
      return;
    this.current = u;
    for (const l of this.listeners) l(u);
  }

  onUser(l: (u: CloudUser | null) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  user(): CloudUser | null {
    return this.current;
  }

  async ensureUser(): Promise<CloudUser> {
    if (this.current) return this.current;
    const { data, error } = await this.sb.auth.signInAnonymously();
    if (error || !data.user) {
      if (error?.status === 429)
        throw new CloudError(
          "too many new users from your network just now; try again in an hour",
          "quota",
        );
      fail("Could not start cloud storage", error);
    }
    this.setSession(data.session);
    return toUser(data.user);
  }

  // Accounts: email and password, or Google. Creating an account emails a link that confirms the
  // address; the page that asked notices on its own (`watchConfirmation`), so it keeps any work
  // not saved yet while the link opens in another tab or device. A forgotten password is reset
  // by a link too, which opens the editor where the new password is chosen (`recovery`).

  /** Whether this backend offers Google sign-in (its Auth settings say so). */
  async googleEnabled(): Promise<boolean> {
    try {
      const r = await fetch(`${this.config.url}/auth/v1/settings`, {
        headers: { apikey: this.config.publishableKey },
      });
      const j = (await r.json()) as { external?: { google?: boolean } };
      return j.external?.google === true;
    } catch {
      return false;
    }
  }

  /**
   * Starts an account for `email` and `password`: the current user (an anonymous one is made if
   * there is none) gets both, and becomes an account, with the same projects, once the link
   * emailed to the address is opened (`onUser` then reports it). 'taken': the email has an account.
   */
  async createAccount(
    email: string,
    password: string,
  ): Promise<"sent" | "taken"> {
    await this.ensureUser();
    const { error } = await this.sb.auth.updateUser(
      { email, password },
      { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    );
    if (!error) {
      this.watchConfirmation();
      return "sent";
    }
    if (
      error.code === "email_exists" ||
      /already been registered/.test(error.message)
    )
      return "taken";
    fail("Could not create the account", error);
  }

  /** Sends the confirmation link again. */
  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.sb.auth.resend({
      type: "email_change",
      email,
      options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    });
    if (error) fail("Could not send the email again", error);
    this.watchConfirmation();
  }

  private stopWatching: (() => void) | null = null;

  /**
   * Until the link is opened (it works for an hour): asks Auth every few seconds, and whenever
   * this page comes back to the front, whether the user is an account now; then refreshes the
   * session, whose token says so to the database too.
   */
  private watchConfirmation() {
    this.stopWatching?.();
    const until = Date.now() + 3600_000;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      if (Date.now() > until || !this.current?.anonymous) return stop();
      checking = true;
      try {
        const { data } = await this.sb.auth.getUser();
        if (data.user && !data.user.is_anonymous) {
          stop();
          const { data: r } = await this.sb.auth.refreshSession();
          if (r.session) this.setSession(r.session);
        }
      } catch {
        // Offline for a moment: the next check.
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 4000);
    const onFront = () => void check();
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    const stop = () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFront);
      window.removeEventListener("focus", onFront);
      this.stopWatching = null;
    };
    this.stopWatching = stop;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.sb.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      if (error.code === "invalid_credentials")
        throw new CloudError("wrong email or password", "auth");
      if (error.code === "email_not_confirmed")
        throw new CloudError(
          "this account is not confirmed yet: open the link we emailed you, or create the account again to get a new one",
          "auth",
        );
      fail("Could not sign in", error);
    }
    this.setSession(data.session);
  }

  /**
   * Emails a link to choose a new password. Without PKCE (Auth's client would add it), so the
   * link works on another device too: it brings the session back in the URL (`readRecovery`).
   */
  async sendPasswordReset(email: string): Promise<void> {
    const redirect = encodeURIComponent(
      location.origin + import.meta.env.BASE_URL,
    );
    let r: Response;
    try {
      r = await fetch(
        `${this.config.url}/auth/v1/recover?redirect_to=${redirect}`,
        {
          method: "POST",
          headers: {
            apikey: this.config.publishableKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        },
      );
    } catch (e) {
      fail("Could not send the email", { message: String(e) });
    }
    if (r.ok) return;
    const j = (await r.json().catch(() => ({}))) as {
      msg?: string;
      message?: string;
    };
    if (r.status === 429)
      throw new CloudError(
        "too many emails just now; wait a minute and try again",
      );
    fail("Could not send the email", {
      message: j.msg ?? j.message ?? `error ${r.status}`,
    });
  }

  /** The new password, once a reset link signed this page in (`recovery`). */
  async setPassword(password: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) fail("That password was refused", error);
  }

  /**
   * Leaves for Google and comes back signed in. An anonymous user is linked (same user, same
   * projects) unless `signIn`: then it signs in to the Google account's own Vitryne account, and
   * the anonymous user's projects move to it on return (`takeReturn`).
   */
  async continueWithGoogle(
    o: { signIn?: boolean; reopen?: string } = {},
  ): Promise<void> {
    // Always the start page (one URL to allow in the backend); the stash reopens the project.
    const redirectTo = location.origin + import.meta.env.BASE_URL;
    const from =
      this.current?.anonymous && this.lastSession
        ? { token: this.lastSession.access_token, user: this.current }
        : undefined;
    try {
      sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({ reopen: o.reopen, from } satisfies Stash),
      );
    } catch {
      // Without session storage the project just doesn't reopen.
    }
    const { error } =
      from && !o.signIn
        ? await this.sb.auth.linkIdentity({
            provider: "google",
            options: { redirectTo },
          })
        : await this.sb.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
    if (error) {
      this.takeReturn();
      fail("Could not reach Google", error);
    }
  }

  /** What a Google sign-in left to do on return (then forgotten). */
  takeReturn(): Stash | null {
    try {
      const s = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      return s ? (JSON.parse(s) as Stash) : null;
    } catch {
      return null;
    }
  }

  /** The anonymous user a Google sign-in left behind, to move projects from. */
  fromStash(s: Stash): SupabaseBackend | null {
    return s.from && s.from.user.id !== this.current?.id
      ? SupabaseBackend.frozen(this.config, s.from.token, s.from.user)
      : null;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut({ scope: "local" });
    this.setSession(null);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    if (!this.current) return [];
    const { data, error } = await this.sb
      .from("projects")
      .select("id,name,bytes,revision,updated_at,thumbnail")
      .order("updated_at", { ascending: false });
    if (error) fail("Could not list your cloud projects", error);
    return (data as Row[]).map(summary);
  }

  async getProject(id: string): Promise<ProjectRow> {
    const { data, error } = await this.sb
      .from("projects")
      .select("id,owner,name,manifest,bytes,revision,updated_at,thumbnail")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("Could not open the project", error);
    if (!data)
      throw new CloudError(
        "that project is gone (deleted from another tab or browser?)",
      );
    return full(data as Row);
  }

  async insertProject(p: {
    name: string;
    manifest: Manifest;
    bytes: number;
    thumbnail?: string | null;
  }): Promise<ProjectRow> {
    const { data, error } = await this.sb
      .from("projects")
      .insert(p)
      .select("id,owner,name,manifest,bytes,revision,updated_at,thumbnail")
      .single();
    if (error) fail("Not saved", error);
    return full(data as Row);
  }

  async updateProject(
    id: string,
    revision: number,
    p: { name: string; manifest: Manifest; bytes: number },
  ): Promise<ProjectRow | null> {
    const { data, error } = await this.sb
      .from("projects")
      .update(p)
      .eq("id", id)
      .eq("revision", revision)
      .select("id,owner,name,manifest,bytes,revision,updated_at,thumbnail");
    if (error) fail("Not saved", error);
    const rows = data as Row[];
    return rows[0] ? full(rows[0]) : null;
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.sb.from("projects").delete().eq("id", id);
    if (error) fail("Could not delete the project", error);
  }

  async setThumbnail(id: string, sha256: string): Promise<void> {
    const { error } = await this.sb
      .from("projects")
      .update({ thumbnail: sha256 })
      .eq("id", id);
    if (error) fail("Thumbnail not saved", error);
  }

  async hasPart(name: string): Promise<boolean> {
    const { data, error } = await this.sb.storage.from(BUCKET).exists(name);
    // `exists` reports a missing object as an error with data false.
    if (error && data) fail("Could not reach cloud storage", error);
    return data;
  }

  async uploadPart(
    name: string,
    bytes: ArrayBuffer,
    mediaType: string,
  ): Promise<void> {
    const { error } = await this.sb.storage
      .from(BUCKET)
      .upload(name, new Blob([bytes], { type: mediaType }), {
        upsert: false,
        contentType: mediaType,
      });
    if (!error) return;
    const status =
      (error as { statusCode?: string; status?: number }).statusCode ??
      String((error as { status?: number }).status ?? "");
    if (status === "409" || /already exists|Duplicate/i.test(error.message))
      return;
    if (/row-level security|403|Unauthorized/.test(error.message + status)) {
      const u = await this.usage().catch(() => null);
      if (u && u.usedBytes >= u.quotaBytes)
        throw new CloudError(
          "your cloud storage is full; delete projects you no longer need",
          "quota",
        );
    }
    if (/maximum allowed size|too large|413/i.test(error.message + status))
      throw new CloudError(
        "a part of this project is larger than this instance accepts",
        "quota",
      );
    fail("Not saved", error);
  }

  async downloadPart(name: string): Promise<ArrayBuffer> {
    const { data, error } = await this.sb.storage.from(BUCKET).download(name);
    if (error || !data) fail("Could not download the project", error);
    return data.arrayBuffer();
  }

  async listParts(): Promise<string[]> {
    const u = this.current;
    if (!u) return [];
    const out: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.sb.storage
        .from(BUCKET)
        .list(u.id, { limit: 1000, offset });
      if (error) fail("Could not list your stored files", error);
      out.push(...data.map((o) => `${u.id}/${o.name}`));
      if (data.length < 1000) return out;
    }
  }

  async removeParts(names: string[]): Promise<void> {
    if (!names.length) return;
    const { error } = await this.sb.storage.from(BUCKET).remove(names);
    if (error) fail("Could not delete stored files", error);
  }

  async unusedParts(): Promise<string[]> {
    const { data, error } = await this.sb.rpc("my_unused_parts");
    if (error) fail("Could not tidy cloud storage", error);
    return data as string[];
  }

  async usage(): Promise<Usage> {
    const { data, error } = await this.sb.rpc("my_usage");
    if (error) fail("Could not read your storage use", error);
    const r = (
      data as {
        used_bytes: number;
        quota_bytes: number;
        projects: number;
        max_projects: number;
      }[]
    )[0];
    if (!r) throw new CloudError("not signed in", "auth");
    return {
      usedBytes: r.used_bytes,
      quotaBytes: r.quota_bytes,
      projects: r.projects,
      maxProjects: r.max_projects,
    };
  }

  async deleteUser(): Promise<void> {
    const { error } = await this.sb.rpc("delete_my_account");
    if (error) fail("Could not delete the account", error);
    try {
      // A detached backend has no auth to sign out of.
      await this.sb.auth.signOut({ scope: "local" });
    } catch {
      // Signed out anyway: the user is gone.
    }
    this.setSession(null);
  }
}
