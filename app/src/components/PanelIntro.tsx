// SPDX-License-Identifier: AGPL-3.0-or-later

export function PanelIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground m-0 text-sm leading-snug">{children}</p>
  );
}
