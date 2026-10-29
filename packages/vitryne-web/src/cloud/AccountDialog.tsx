// SPDX-License-Identifier: AGPL-3.0-or-later
// The account dialog (docs/CLOUD.md). No sign-up wall: anyone can try the editor, and their
// work is kept as one draft (an anonymous user); a free account keeps every project, opens them
// anywhere, and exports. A new account is confirmed by a link in an email: this dialog waits and
// notices, so the work here stays put while the link opens elsewhere. A forgotten password is
// reset by a link too: the editor it opens asks for the new one.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { AccountPanel } from "./AccountPanel";
import { AuthPanel, type AuthMode, type AuthStage } from "./AuthPanel";
import { CheckEmailPanel } from "./CheckEmailPanel";
import { DeletePanel } from "./DeletePanel";
import { MIN_PASSWORD, PasswordField } from "./PasswordField";

/** Where the dialog is. Creating an account and signing in are `home` (`AuthPanel`'s mode and stage). */
type Step =
  | { at: "home" }
  | { at: "confirm"; email: string }
  | { at: "reset" }
  | { at: "reset-sent"; email: string }
  | { at: "new-password" }
  | { at: "delete" };

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
  const [rawStep, setStep] = useState<Step>(
    props.recovering ? { at: "new-password" } : { at: "home" },
  );
  const [mode, setMode] = useState<AuthMode>("create");
  const [stage, setStage] = useState<AuthStage>("email");
  const [moving, setMoving] = useState(false);
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
  const confirmed = rawStep.at === "confirm" && !!user && !user.anonymous;
  const confirmedEmail = rawStep.at === "confirm" ? rawStep.email : "";
  const step: Step = confirmed ? { at: "home" } : rawStep;
  const { onInfo } = props;
  const { refresh } = cloud;
  useEffect(() => {
    if (!confirmed) return;
    refresh();
    onInfo(
      `Account created. Sign in with ${confirmedEmail} on any device to open your projects.`,
    );
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

  /** The sign-in form for `email` (a reset was sent, the account was taken). */
  const toSignIn = (moved = false) => {
    setMode("in");
    setStage("password");
    setMoving(moved);
    go({ at: "home" });
  };

  let title = "Get started for free";
  let body: React.ReactNode;
  if (step.at === "confirm") {
    title = "Check your email";
    body = (
      <CheckEmailPanel
        email={step.email}
        working={!!working}
        onResend={() =>
          void run("Sending", async () => {
            await (await cloud.backend()).resendConfirmation(step.email);
            props.onInfo(`We sent the link to ${step.email} again.`);
          })
        }
        backLabel="Use another email"
        onBack={() => {
          setMode("create");
          setStage("email");
          go({ at: "home" });
        }}
      >
        We sent a link to <strong>{step.email}</strong>. Open it to confirm the
        address and finish creating your account. You can keep working here:
        this window notices once it's done.
      </CheckEmailPanel>
    );
  } else if (step.at === "reset") {
    title = "Reset your password";
    body = (
      <form
        className="flex flex-col gap-4 text-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          void run("Sending the link", async () => {
            const to = email.trim();
            await (await cloud.backend()).sendPasswordReset(to);
            setStep({ at: "reset-sent", email: to });
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cloud-email">Email</Label>
          <Input
            id="cloud-email"
            type="email"
            className="h-11 rounded-xl"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <p className="text-muted-foreground m-0 text-[13px]">
          We'll email you a link to choose a new password.
        </p>
        <Button type="submit" disabled={!!working || !email.trim()}>
          {working ?? "Send the link"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => toSignIn()}>
          Back to sign in
        </Button>
      </form>
    );
  } else if (step.at === "reset-sent") {
    title = "Check your email";
    body = (
      <CheckEmailPanel
        email={step.email}
        working={!!working}
        onResend={() =>
          void run("Sending", async () => {
            await (await cloud.backend()).sendPasswordReset(step.email);
            props.onInfo(`We sent the link to ${step.email} again.`);
          })
        }
        backLabel="Back to sign in"
        onBack={() => toSignIn()}
      >
        If <strong>{step.email}</strong> has an account, we sent it a link. Open
        it to choose a new password: it opens Vitryne, signed in. Work not saved
        yet stays in this window.
      </CheckEmailPanel>
    );
  } else if (step.at === "new-password") {
    title = "Choose a new password";
    body = (
      <form
        className="flex flex-col gap-4 text-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
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
          );
        }}
      >
        <p className="m-0">
          Choose a new password for <strong>{user?.email}</strong>.
        </p>
        <PasswordField
          id="cloud-new-password"
          label={`New password (${MIN_PASSWORD} characters or more)`}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
        />
        <Button
          type="submit"
          disabled={!!working || password.length < MIN_PASSWORD}
        >
          {working ?? "Save the password"}
        </Button>
      </form>
    );
  } else if (step.at === "delete") {
    title = "Delete your account?";
    body = (
      <DeletePanel
        working={working}
        onExport={() => void exportData()}
        onKeep={() => go({ at: "home" })}
        onDelete={() => void removeAccount()}
      />
    );
  } else if (user && !user.anonymous) {
    title = "Your account";
    body = (
      <AccountPanel
        email={user.email ?? ""}
        avatarUrl={user.avatarUrl}
        usage={usage}
        working={working}
        onExport={() => void exportData()}
        onSignOut={() => void signOut()}
        onDelete={() => go({ at: "delete" })}
      />
    );
  } else {
    if (mode === "in") title = "Welcome back";
    else if (props.reason || user?.anonymous) title = "Keep your work";
    body = (
      <AuthPanel
        mode={mode}
        stage={stage}
        email={email}
        password={password}
        working={working}
        google={google}
        googleTaken={googleTaken}
        moving={moving}
        hasDraft={!!user?.anonymous}
        privacyPolicy={cloud.config.privacyPolicy}
        termsOfService={cloud.config.termsOfService}
        onMode={(m) => {
          setMode(m);
          setMoving(false);
          setError(null);
        }}
        onEmail={setEmail}
        onPassword={setPassword}
        onStage={(s) => {
          setStage(s);
          setMoving(false);
          setError(null);
          setPassword("");
        }}
        onGoogle={props.onGoogle}
        onForgot={() => go({ at: "reset" })}
        onSubmit={() =>
          mode === "in"
            ? void signingIn("Signing in", (b) =>
                b.signIn(email.trim(), password),
              )
            : void run("Creating the account", async () => {
                const to = email.trim();
                const b = await cloud.backend();
                const r = await b.createAccount(to, password);
                setPassword("");
                if (r === "taken") {
                  setMode("in");
                  setMoving(true);
                } else setStep({ at: "confirm", email: to });
              })
        }
      />
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[440px] rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            {title}
          </DialogTitle>
          <DialogDescription
            className={
              props.reason && step.at === "home"
                ? "text-body-text text-[15px]"
                : "sr-only"
            }
          >
            {props.reason && step.at === "home"
              ? props.reason
              : "Your Vitryne account"}
          </DialogDescription>
        </DialogHeader>
        {body}
        {error && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-foreground m-0 rounded-xl px-3 py-2.5 text-sm"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
