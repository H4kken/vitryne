// SPDX-License-Identifier: AGPL-3.0-or-later
import { DOCS_URL, FEEDBACK_URL, LICENSE_URL, REPO_URL } from "@/links";
import { Logo } from "../icons/Logo";

const LINK = "body-6 hover:text-foreground hover:underline underline-offset-4";

/** The start screen's footer: who we are, links in columns, then the version and the licence. */
export function StartFooter(props: {
  /** The instance's legal pages (packages/vitryne-docs/content/docs/developers/cloud.md). */
  privacyPolicy: string | null;
  termsOfService: string | null;
}) {
  const columns: [string, [string, string][]][] = [
    [
      "Resources",
      [
        ["Documentation", DOCS_URL],
        ["Changelog", `${DOCS_URL}/changelog/`],
        ["Host it yourself", `${DOCS_URL}/self-hosting/`],
        ["Source code", REPO_URL],
      ],
    ],
    ["Community", [["Send feedback", FEEDBACK_URL]]],
    [
      "Legal",
      [
        ...(props.privacyPolicy
          ? ([["Privacy policy", props.privacyPolicy]] as [string, string][])
          : []),
        ...(props.termsOfService
          ? ([["Terms", props.termsOfService]] as [string, string][])
          : []),
      ],
    ],
  ];
  return (
    <footer className="border-border mt-auto w-full shrink-0 border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-8 py-12">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <div className="text-foreground flex items-center gap-2 [&_img]:rounded-lg">
              <Logo size={36} />
              <span className="heading-6">Vitryne</span>
            </div>
            <p className="body-6 m-0 max-w-[280px]">
              A free, open source garment designer in your browser.
            </p>
          </div>
          {columns
            .filter(([, links]) => links.length > 0)
            .map(([title, links]) => (
              <nav
                key={title}
                aria-label={title}
                className="flex flex-col gap-3"
              >
                <h2 className="caption-4 m-0">{title}</h2>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {links.map(([label, href]) => (
                    <li key={label}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className={LINK}
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
        </div>
        <div className="caption-2 flex flex-wrap justify-end gap-x-5 gap-y-1">
          <span>v{__APP_VERSION__}</span>
          <span>
            Licensed under{" "}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground underline underline-offset-4"
            >
              AGPL
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
