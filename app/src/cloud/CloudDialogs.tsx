// SPDX-License-Identifier: AGPL-3.0-or-later
// The cloud screens (docs/CLOUD.md): the person's projects, and the account dialog. No sign-up
// wall: anyone can try the editor, and their work is kept as one draft (an anonymous user); a
// free account keeps every project, opens them anywhere, and exports. Codes come by email and are
// typed here, so no link or redirect can lose work not saved yet.

import { useEffect, useState } from "react";
import { Cloud as CloudIcon, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectSummary, Usage } from "./backend";
import {
  deleteAccount,
  deleteProject,
  duplicateProject,
  exportAll,
  fetchAhead,
  moveProjects,
} from "./projects";
import type { Cloud } from "./useCloud";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function save(name: string, bytes: ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The person's projects: open, duplicate (an account), delete. */
export function CloudProjectList(props: {
  cloud: Cloud;
  projects: ProjectSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = props.cloud.user && !props.cloud.user.anonymous;

  const duplicate = async (p: ProjectSummary) => {
    setWorking(p.id);
    setError(null);
    try {
      await duplicateProject(await props.cloud.backend(), p.id);
      props.cloud.refresh();
    } catch (e) {
      setError(`Could not duplicate ${p.name}: ${message(e)}`);
    } finally {
      setWorking(null);
    }
  };

  const remove = async (p: ProjectSummary) => {
    setWorking(p.id);
    setError(null);
    try {
      await deleteProject(await props.cloud.backend(), p.id);
      props.cloud.refresh();
    } catch (e) {
      setError(`Could not delete ${p.name}: ${message(e)}`);
    } finally {
      setWorking(null);
      setConfirm(null);
    }
  };

  if (!props.projects.length)
    return (
      <p className="text-muted-foreground m-0 text-sm">
        No projects yet. Change an example or import a pattern, and it is saved
        here.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col divide-y divide-[#E1E4DE] p-0">
        {props.projects.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <button
              type="button"
              disabled={props.busy || working !== null}
              onClick={() => props.onOpen(p.id)}
              // Pointing at a project starts its download, so the click opens it sooner.
              onPointerEnter={() =>
                void props.cloud.backend().then(
                  (b) => fetchAhead(b, p.id),
                  () => undefined,
                )
              }
              onFocus={() =>
                void props.cloud.backend().then(
                  (b) => fetchAhead(b, p.id),
                  () => undefined,
                )
              }
              className="flex min-w-0 grow flex-col text-left disabled:opacity-60"
            >
              <span className="truncate text-[15px] font-semibold">
                {p.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {new Date(p.updatedAt).toLocaleString()} ·{" "}
                {formatBytes(p.bytes)}
              </span>
            </button>
            {confirm === p.id ? (
              <>
                <span className="text-sm">Delete for good?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={working !== null}
                  onClick={() => void remove(p)}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm(null)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy || working !== null}
                  onClick={() => props.onOpen(p.id)}
                >
                  Open
                </Button>
                {account && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Duplicate ${p.name}`}
                    disabled={working !== null}
                    onClick={() => void duplicate(p)}
                  >
                    <Copy className="size-4" />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${p.name}`}
                  disabled={working !== null}
                  onClick={() => setConfirm(p.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="m-0 text-sm text-[#8A2410]">{error}</p>}
    </div>
  );
}

export function CloudProjectsDialog(props: {
  cloud: Cloud;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const { cloud, open } = props;
  // `backend` and `refresh` are stable; `cloud` itself changes with every new list.
  const { backend, refresh } = cloud;
  useEffect(() => {
    if (open)
      void backend().then(
        () => refresh(),
        () => undefined,
      );
  }, [open, backend, refresh]);
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[560px] rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Your projects
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {!cloud.user
              ? "Nothing saved from this browser yet. Sign in to see the projects in your account."
              : cloud.user.anonymous
                ? "Without an account you keep one project, your draft. Create a free account to keep several."
                : "Open one, duplicate it, or delete it."}
          </DialogDescription>
        </DialogHeader>
        {cloud.user && cloud.projects && (
          <div className="max-h-[50vh] overflow-y-auto">
            <CloudProjectList
              cloud={cloud}
              projects={cloud.projects}
              busy={props.busy}
              onOpen={(id) => {
                props.onOpenChange(false);
                props.onOpen(id);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Step =
  | { at: "home" }
  | { at: "sign-in"; email?: string; moving?: boolean }
  | { at: "create" }
  | { at: "code"; email: string; password: string }
  | { at: "reset"; email?: string }
  | { at: "reset-code"; email: string }
  | { at: "delete" };

const MIN_PASSWORD = 8;

/**
 * Cloud account: sign in (email and password, or Google), create an account from the anonymous
 * user (same projects), reset a password, storage use, download everything, delete. Mount it
 * while open, so each opening starts at its first screen.
 */
export function AccountDialog(props: {
  cloud: Cloud;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInfo: (text: string) => void;
  /** Why the dialog was opened (export, a second project): shown first. */
  reason?: string | null;
  /** Projects moved into the account signed in to (new ids by old ones): an open one follows. */
  onMoved: (ids: Record<string, string>) => void;
  /** Leaves for Google (after the unsaved-changes question). `signIn`: into that Google account's own. */
  onGoogle: (signIn: boolean) => void;
  /** What a Google sign-in came back with, when it failed. */
  returnError?: { code: string; message: string } | null;
}) {
  const { cloud } = props;
  const user = cloud.user;
  const [step, setStep] = useState<Step>({ at: "home" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    props.returnError && props.returnError.code !== "identity_already_exists"
      ? props.returnError.message
      : null,
  );
  const [usage, setUsage] = useState<Usage | null>(null);
  const [google, setGoogle] = useState(false);
  const googleTaken = props.returnError?.code === "identity_already_exists";

  const { backend } = cloud;
  useEffect(() => {
    if (user)
      void backend()
        .then((b) => b.usage())
        .then(setUsage, () => setUsage(null));
  }, [user, backend]);
  useEffect(() => {
    void backend()
      .then((b) => b.googleEnabled())
      .then(setGoogle, () => setGoogle(false));
  }, [backend]);

  const run = async (what: string, f: () => Promise<void>) => {
    setWorking(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(null);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setCode("");
    setPassword("");
    setStep(s);
  };

  /** Runs a sign-in; an anonymous user's projects follow them into the account they reach. */
  const signingIn = (
    what: string,
    f: (b: Awaited<ReturnType<Cloud["backend"]>>) => Promise<void>,
  ) =>
    run(what, async () => {
      const b = await cloud.backend();
      const from = b.user()?.anonymous ? b.detached() : null;
      await f(b);
      const me = b.user();
      if (from && me && from.user()?.id !== me.id) {
        const r = await moveProjects(from, b);
        props.onMoved(r.ids);
        if (r.failed.length)
          props.onInfo(
            `Signed in. These projects could not be moved from this browser and stay there: ${r.failed.join(", ")}.`,
          );
        else if (r.moved)
          props.onInfo(
            `Signed in as ${me.email ?? "you"}. ${r.moved} project${r.moved === 1 ? "" : "s"} from this browser moved to your account.`,
          );
      }
      cloud.refresh();
      go({ at: "home" });
    });

  const exportData = () =>
    run("Preparing your download", async () => {
      const b = await cloud.backend();
      const u = b.user();
      const zip = await exportAll(b, {
        id: u?.id,
        email: u?.email,
        anonymous: u?.anonymous,
        usage,
      });
      save(
        `vitryne-data-${new Date().toISOString().slice(0, 10)}.zip`,
        zip,
        "application/zip",
      );
    });

  const removeAccount = () =>
    run("Deleting", async () => {
      await deleteAccount(await cloud.backend());
      cloud.refresh();
      props.onOpenChange(false);
      props.onInfo("Your account and everything stored with it are deleted.");
    });

  const signOut = () =>
    run("Signing out", async () => {
      await (await cloud.backend()).signOut();
      props.onOpenChange(false);
    });

  const googleButton = (signIn: boolean) =>
    google && (
      <Button
        type="button"
        variant="outline"
        onClick={() => props.onGoogle(signIn)}
      >
        <GoogleIcon /> Continue with Google
      </Button>
    );

  const emailField = (
    <>
      <Label htmlFor="cloud-email">Email</Label>
      <Input
        id="cloud-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
      />
    </>
  );
  const passwordField = (id: string, label: string, autoComplete: string) => (
    <>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        required
        minLength={autoComplete === "new-password" ? MIN_PASSWORD : undefined}
        autoComplete={autoComplete}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
    </>
  );
  const codeField = (to: string) => (
    <>
      <Label htmlFor="cloud-code">The 6-digit code sent to {to}</Label>
      <Input
        id="cloud-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        autoFocus
        className="font-mono text-lg tracking-[0.3em]"
      />
      <p className="text-muted-foreground m-0 text-[13px]">
        Nothing arrived? Check your spam folder.
      </p>
    </>
  );
  const footer = (back: Step, submit: string, disabled: boolean) => (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={() => go(back)}>
        Back
      </Button>
      <Button type="submit" disabled={!!working || disabled}>
        {working ?? submit}
      </Button>
    </DialogFooter>
  );
  const form = (onSubmit: () => void, children: React.ReactNode) => (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );

  let body: React.ReactNode;
  if (step.at === "sign-in")
    body = form(
      () =>
        void signingIn("Signing in", (b) => b.signIn(email.trim(), password)),
      <>
        {step.moving && (
          <p className="m-0 text-[15px]">
            This email already has an account. Sign in to it: the projects saved
            from this browser move to it.
          </p>
        )}
        {emailField}
        {passwordField("cloud-password", "Password", "current-password")}
        <button
          type="button"
          className="self-start text-sm underline underline-offset-4"
          onClick={() => go({ at: "reset", email })}
        >
          Forgot your password?
        </button>
        {footer({ at: "home" }, "Sign in", !email.trim() || !password)}
      </>,
    );
  else if (step.at === "create")
    body = form(
      () =>
        void run("Sending the code", async () => {
          const to = email.trim();
          if ((await (await cloud.backend()).createAccount(to)) === "taken") {
            setStep({ at: "sign-in", moving: true });
            setPassword("");
            return;
          }
          setCode("");
          setStep({ at: "code", email: to, password });
        }),
      <>
        {emailField}
        {passwordField(
          "cloud-password",
          `Password (${MIN_PASSWORD} characters or more)`,
          "new-password",
        )}
        <p className="text-muted-foreground m-0 text-[13px]">
          We'll email you a code to confirm the address.
        </p>
        {footer(
          { at: "home" },
          "Create the account",
          !email.trim() || password.length < MIN_PASSWORD,
        )}
      </>,
    );
  else if (step.at === "code")
    body = form(
      () =>
        void run("Checking", async () => {
          await (
            await cloud.backend()
          ).confirmAccount(step.email, code.trim(), step.password);
          cloud.refresh();
          props.onInfo(
            `Account created. Sign in with ${step.email} on any device to open your projects.`,
          );
          go({ at: "home" });
        }),
      <>
        {codeField(step.email)}
        {footer({ at: "create" }, "Confirm", code.length !== 6)}
      </>,
    );
  else if (step.at === "reset")
    body = form(
      () =>
        void run("Sending the code", async () => {
          const to = email.trim();
          await (await cloud.backend()).sendPasswordReset(to);
          setCode("");
          setPassword("");
          setStep({ at: "reset-code", email: to });
        }),
      <>
        {emailField}
        <p className="text-muted-foreground m-0 text-[13px]">
          We'll email you a code to choose a new password.
        </p>
        {footer({ at: "sign-in" }, "Send the code", !email.trim())}
      </>,
    );
  else if (step.at === "reset-code")
    body = form(
      () =>
        void signingIn("Saving", (b) =>
          b.resetPassword(step.email, code.trim(), password),
        ),
      <>
        {codeField(step.email)}
        {passwordField(
          "cloud-new-password",
          `New password (${MIN_PASSWORD} characters or more)`,
          "new-password",
        )}
        {footer(
          { at: "reset", email: step.email },
          "Save and sign in",
          code.length !== 6 || password.length < MIN_PASSWORD,
        )}
      </>,
    );
  else if (step.at === "delete")
    body = (
      <div className="flex flex-col gap-3 text-[15px]">
        <p className="m-0">
          This deletes your account and every project stored with it, for good.
          Files you exported are not touched. Want a copy first?{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void exportData()}
          >
            Download everything
          </button>
          .
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => go({ at: "home" })}>
            Keep my account
          </Button>
          <Button
            variant="destructive"
            disabled={!!working}
            onClick={() => void removeAccount()}
          >
            {working ?? "Delete everything"}
          </Button>
        </DialogFooter>
      </div>
    );
  else
    body = (
      <div className="flex flex-col gap-4 text-[15px]">
        {googleTaken && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E1E4DE] p-3">
            <p className="m-0">
              That Google account already has a Vitryne account. Sign in to it?
              The projects saved from this browser move to it.
            </p>
            <div>
              <Button onClick={() => props.onGoogle(true)}>
                <GoogleIcon /> Sign in with Google
              </Button>
            </div>
          </div>
        )}
        {props.reason && <p className="m-0 font-semibold">{props.reason}</p>}
        {!user && (
          <>
            <p className="m-0">
              Without an account you can try everything, and your work is kept
              as one draft in this browser. A free account keeps all your
              projects, opens them on any device, and exports them.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => go({ at: "sign-in" })}>Sign in</Button>
              <Button variant="outline" onClick={() => go({ at: "create" })}>
                Create an account
              </Button>
              {googleButton(false)}
            </div>
          </>
        )}
        {user?.anonymous && (
          <>
            <p className="m-0">
              Your draft is kept in this browser for now (30 days after your
              last visit). Create a free account to keep it for good, keep
              several projects, open them on any device, and export them.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => go({ at: "create" })}>
                Create an account
              </Button>
              {googleButton(false)}
              <Button variant="ghost" onClick={() => go({ at: "sign-in" })}>
                I have an account
              </Button>
            </div>
          </>
        )}
        {user && !user.anonymous && (
          <p className="m-0">
            Signed in as <strong>{user.email}</strong>.
          </p>
        )}
        {user && usage && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-[#E8ECE4]">
              <div
                className="bg-primary h-full"
                style={{
                  width: `${Math.min(100, (100 * usage.usedBytes) / Math.max(1, usage.quotaBytes))}%`,
                }}
              />
            </div>
            <span className="text-muted-foreground text-[13px]">
              {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}{" "}
              used · {usage.projects} project{usage.projects === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {user && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <button
              type="button"
              className="underline underline-offset-4"
              disabled={!!working}
              onClick={() => void exportData()}
            >
              Download all my data
            </button>
            {!user.anonymous && (
              <button
                type="button"
                className="underline underline-offset-4"
                disabled={!!working}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            )}
            <button
              type="button"
              className="text-[#8A2410] underline underline-offset-4"
              onClick={() => go({ at: "delete" })}
            >
              Delete my account
            </button>
          </div>
        )}
        {working && (
          <p className="text-muted-foreground m-0 text-sm">{working}…</p>
        )}
      </div>
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[480px] rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-2xl font-bold">
            <CloudIcon className="size-6" /> Cloud
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            Free.{" "}
            {cloud.config.privacyPolicy && (
              <a
                href={cloud.config.privacyPolicy}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Privacy policy
              </a>
            )}
          </DialogDescription>
        </DialogHeader>
        {body}
        {error && (
          <p role="alert" className="m-0 text-sm text-[#8A2410]">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Google's "G", in its own colours (its brand rules for sign-in buttons). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
