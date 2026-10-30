// SPDX-License-Identifier: AGPL-3.0-or-later
import { InfoPage } from "./InfoPage";

export function NoBackend() {
  return (
    <InfoPage title="This Vitryne has no backend">
      <p className="text-body-text m-0 text-[19px] leading-normal">
        Projects are saved to a backend, and this instance doesn't name one: its{" "}
        <code>config.json</code> is missing or incomplete.
      </p>
      <p className="text-body-text m-0 text-[17px] leading-normal">
        If you run it, set <code>SUPABASE_URL</code> and{" "}
        <code>SUPABASE_PUBLISHABLE_KEY</code>{" "}
        (packages/vitryne-docs/content/docs/developers/cloud.md). In
        development, start it with <code>pnpm run dev</code>, which starts the
        local backend too.
      </p>
    </InfoPage>
  );
}
