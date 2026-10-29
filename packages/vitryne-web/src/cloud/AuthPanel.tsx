// SPDX-License-Identifier: AGPL-3.0-or-later

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "./GoogleIcon";
import { LegalLine } from "./LegalLine";
import { MIN_PASSWORD, PasswordField } from "./PasswordField";

export type AuthMode = "create" | "in";
export type AuthStage = "email" | "password";

/**
 * Creating an account or signing in, email first (docs/CLOUD.md): Google or an email address,
 * then the password on a second screen. Whether the address has an account is never looked up
 * (that would tell anyone which emails are registered), so the person says which they want.
 */
export function AuthPanel(props: {
  mode: AuthMode;
  stage: AuthStage;
  email: string;
  password: string;
  working: string | null;
  google: boolean;
  /** That Google account already has a Vitryne account (back from Google). */
  googleTaken: boolean;
  /** An email that already has an account was given to create one: sign in to it. */
  moving: boolean;
  /** The anonymous user's draft, to say it comes along. */
  hasDraft: boolean;
  privacyPolicy: string | null;
  termsOfService: string | null;
  onMode: (m: AuthMode) => void;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onStage: (s: AuthStage) => void;
  onGoogle: (signIn: boolean) => void;
  onForgot: () => void;
  onSubmit: () => void;
}) {
  const { mode, stage, email, password, working } = props;
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const passwordOk =
    mode === "in" ? password.length > 0 : password.length >= MIN_PASSWORD;
  const swap = (
    <p className="text-muted-foreground m-0 text-center text-[13px]">
      {mode === "create" ? "Already have an account? " : "New to Vitryne? "}
      <button
        type="button"
        className="text-foreground font-semibold underline underline-offset-4"
        onClick={() => props.onMode(mode === "create" ? "in" : "create")}
      >
        {mode === "create" ? "Sign in" : "Create an account"}
      </button>
    </p>
  );
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      {props.googleTaken && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-3">
          <p className="m-0">
            That Google account already has a Vitryne account. Sign in to it?
            The projects saved from this browser move to it.
          </p>
          <Button onClick={() => props.onGoogle(true)}>
            <GoogleIcon /> Sign in with Google
          </Button>
        </div>
      )}
      {props.moving && (
        <p className="bg-secondary m-0 rounded-xl px-3 py-2.5 text-[13px]">
          This email already has an account. Sign in to it: the projects saved
          from this browser move to it.
        </p>
      )}
      {props.hasDraft && stage === "email" && !props.moving && (
        <p className="bg-secondary text-body-text m-0 flex gap-2.5 rounded-xl px-3 py-2.5 text-[13px]">
          <Info className="mt-px size-4 shrink-0" aria-hidden />
          Your draft is kept in this browser for 30 days after your last visit.
          An account keeps it for good, and it comes with you.
        </p>
      )}

      {stage === "email" ? (
        <>
          {props.google && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => props.onGoogle(false)}
              >
                <GoogleIcon /> Continue with Google
              </Button>
              <div className="text-muted-foreground flex items-center gap-3 text-xs tracking-wider uppercase">
                <span className="bg-border h-px flex-1" />
                or
                <span className="bg-border h-px flex-1" />
              </div>
            </>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailOk) props.onStage("password");
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
                placeholder="you@example.com"
                value={email}
                onChange={(e) => props.onEmail(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!emailOk}>
              Continue with email
            </Button>
          </form>
          {swap}
          {email.trim() && (
            <LegalLine
              privacyPolicy={props.privacyPolicy}
              termsOfService={props.termsOfService}
            />
          )}
        </>
      ) : (
        <>
          <div className="bg-secondary flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5">
            <span className="min-w-0 truncate">{email.trim()}</span>
            <button
              type="button"
              className="shrink-0 text-[13px] font-semibold underline underline-offset-4"
              onClick={() => props.onStage("email")}
            >
              Change
            </button>
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailOk && passwordOk) props.onSubmit();
            }}
          >
            <PasswordField
              id="cloud-password"
              label={mode === "in" ? "Password" : "Choose a password"}
              value={password}
              onChange={props.onPassword}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              autoFocus
              aside={
                mode === "in" && (
                  <button
                    type="button"
                    className="text-muted-foreground text-[13px] underline underline-offset-4"
                    onClick={props.onForgot}
                  >
                    Forgot your password?
                  </button>
                )
              }
            />
            {mode === "create" && (
              <p className="text-muted-foreground m-0 text-[13px]">
                We'll email you a link to confirm the address.
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!!working || !passwordOk}
            >
              {working ?? (mode === "in" ? "Sign in" : "Create account")}
            </Button>
          </form>
          {swap}
          <LegalLine
            privacyPolicy={props.privacyPolicy}
            termsOfService={props.termsOfService}
          />
        </>
      )}
    </div>
  );
}
