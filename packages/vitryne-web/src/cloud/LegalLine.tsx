// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExternalLink } from "lucide-react";

/** "By continuing you agree to the Terms and Privacy policy", with the links the instance has. Nothing when it has none. */
export function LegalLine(props: {
  privacyPolicy: string | null;
  termsOfService: string | null;
}) {
  const { privacyPolicy, termsOfService } = props;
  if (!privacyPolicy && !termsOfService) return null;
  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 underline underline-offset-4"
    >
      {label}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
  return (
    <p className="text-muted-foreground m-0 text-center text-xs">
      By continuing you agree to the{" "}
      {termsOfService && link(termsOfService, "Terms")}
      {termsOfService && privacyPolicy && " and "}
      {privacyPolicy && link(privacyPolicy, "Privacy policy")}.
    </p>
  );
}
