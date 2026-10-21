// SPDX-License-Identifier: AGPL-3.0-or-later

export function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground m-0 text-[13px] font-semibold tracking-[0.06em] uppercase">
      {children}
    </h3>
  );
}
