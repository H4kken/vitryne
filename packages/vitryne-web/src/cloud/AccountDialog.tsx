// SPDX-License-Identifier: AGPL-3.0-or-later
// The account dialog (docs/CLOUD.md). No sign-up wall: anyone can try the editor, and their
// work is kept as one draft (an anonymous user); a free account keeps every project, opens them
// anywhere, and exports. A new account is confirmed by a link in an email: this dialog waits and
// notices, so the work here stays put while the link opens elsewhere. A forgotten password is
// reset by a link too: the editor it opens asks for the new one.

import { useEffect, useState } from "react";
import { Cloud as CloudIcon, MailCheck } from "lucide-react";
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
import type { Usage } from "./backend";
import type { SupabaseBackend } from "./supabase";
import { deleteAccount, exportAll, moveProjects } from "./projects";
import type { Cloud } from "./useCloud";
import { errorMessage } from "./errorMessage";
import { GoogleIcon } from "./GoogleIcon";
import { formatBytes } from "./formatBytes";

type Step =
  | { at: "home" }
  | { at: "sign-in"; email?: string; moving?: boolean }
  | { at: "create" }
  | { at: "confirm"; email: string }
  | { at: "reset"; email?: string }
  | { at: "reset-sent"; email: string }
  | { at: "new-password" }
  | { at: "delete" };

const MIN_PASSWORD = 8;

function save(name: string, bytes: ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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
  /** A password reset link opened this page: the new password comes first. */
  recovering?: boolean;
}) {
  const { cloud } = props;
  const user = cloud.user;
  const [step, setStep] = useState<Step>(
    props.recovering ? { at: "new-password" } : { at: "home" },
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
  // The link was opened (here or anywhere): the user is an account now.
  const confirmed = step.at === "confirm" && !!user && !user.anonymous;
  const confirmedEmail = step.at === "confirm" ? step.email : "";
  const { onInfo } = props;
  const { refresh } = cloud;
  useEffect(() => {
    if (!confirmed) return;
    refresh();
    onInfo(
      `Account created. Sign in with ${confirmedEmail} on any device to open your projects.`,
    );
    setError(null);
    setPassword("");
    setStep({ at: "home" });
  }, [confirmed, confirmedEmail, refresh, onInfo]);
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
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setPassword("");
    setStep(s);
  };

  /**
   * Runs a sign-in; an anonymous user's projects follow them into the account they reach.
   * `left`: that user, when the page was already signed in by other means (a reset link).
   */
  const signingIn = (
    what: string,
    f: (b: SupabaseBackend) => Promise<void>,
    left?: (b: SupabaseBackend) => SupabaseBackend | null,
  ) =>
    run(what, async () => {
      const b = await cloud.backend();
      const before = b.user()?.anonymous ? b.detached() : null;
      await f(b);
      const from = left ? left(b) : before;
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
        void run("Creating the account", async () => {
          const to = email.trim();
          const b = await cloud.backend();
          const r = await b.createAccount(to, password);
          setPassword("");
          setStep(
            r === "taken"
              ? { at: "sign-in", moving: true }
              : { at: "confirm", email: to },
          );
        }),
      <>
        {emailField}
        {passwordField(
          "cloud-password",
          `Password (${MIN_PASSWORD} characters or more)`,
          "new-password",
        )}
        <p className="text-muted-foreground m-0 text-[13px]">
          We'll email you a link to confirm the address.
        </p>
        {footer(
          { at: "home" },
          "Create the account",
          !email.trim() || password.length < MIN_PASSWORD,
        )}
      </>,
    );
  else if (step.at === "confirm")
    body = (
      <div className="flex flex-col gap-3 text-[15px]">
        <p className="m-0 flex items-center gap-2 font-semibold">
          <MailCheck className="size-5" /> Check your email
        </p>
        <p className="m-0">
          We sent a link to <strong>{step.email}</strong>. Open it to confirm
          the address and finish creating your account. You can keep working
          here: this window notices once it's done.
        </p>
        <p className="text-muted-foreground m-0 text-[13px]">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            disabled={!!working}
            onClick={() =>
              void run("Sending", async () => {
                await (await cloud.backend()).resendConfirmation(step.email);
                props.onInfo(`We sent the link to ${step.email} again.`);
              })
            }
          >
            send it again
          </button>
          .
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => go({ at: "create" })}
          >
            Use another email
          </Button>
        </DialogFooter>
      </div>
    );
  else if (step.at === "reset")
    body = form(
      () =>
        void run("Sending the link", async () => {
          const to = email.trim();
          await (await cloud.backend()).sendPasswordReset(to);
          setStep({ at: "reset-sent", email: to });
        }),
      <>
        {emailField}
        <p className="text-muted-foreground m-0 text-[13px]">
          We'll email you a link to choose a new password.
        </p>
        {footer({ at: "sign-in" }, "Send the link", !email.trim())}
      </>,
    );
  else if (step.at === "reset-sent")
    body = (
      <div className="flex flex-col gap-3 text-[15px]">
        <p className="m-0 flex items-center gap-2 font-semibold">
          <MailCheck className="size-5" /> Check your email
        </p>
        <p className="m-0">
          If <strong>{step.email}</strong> has an account, we sent it a link.
          Open it to choose a new password: it opens Vitryne, signed in. Work
          not saved yet stays in this window.
        </p>
        <p className="text-muted-foreground m-0 text-[13px]">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            disabled={!!working}
            onClick={() =>
              void run("Sending", async () => {
                await (await cloud.backend()).sendPasswordReset(step.email);
                props.onInfo(`We sent the link to ${step.email} again.`);
              })
            }
          >
            send it again
          </button>
          .
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => go({ at: "sign-in", email: step.email })}
          >
            Back to sign in
          </Button>
        </DialogFooter>
      </div>
    );
  else if (step.at === "new-password")
    body = form(
      () =>
        void signingIn(
          "Saving",
          async (b) => {
            await b.setPassword(password);
            props.onInfo("Your new password is saved.");
          },
          (b) => {
            const from = b.recovery?.from ?? null;
            b.recovery = null;
            return from;
          },
        ),
      <>
        <p className="m-0 text-[15px]">
          Choose a new password for <strong>{user?.email}</strong>.
        </p>
        {passwordField(
          "cloud-new-password",
          `New password (${MIN_PASSWORD} characters or more)`,
          "new-password",
        )}
        <DialogFooter>
          <Button
            type="submit"
            disabled={!!working || password.length < MIN_PASSWORD}
          >
            {working ?? "Save the password"}
          </Button>
        </DialogFooter>
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
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
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
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
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
              className="text-danger underline underline-offset-4"
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
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
