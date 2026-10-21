// SPDX-License-Identifier: AGPL-3.0-or-later

export function FabricBack({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
    >
      {children}
    </button>
  );
}
