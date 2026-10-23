// SPDX-License-Identifier: AGPL-3.0-or-later
// An icon from its name (lib/icons.ts): a Lucide icon, or an image for a logo. Names, not
// elements, because the page tree reaches the island as data and MDX pages build Astro
// elements, not React ones.
import { lucideIcons } from "@/lib/icons";

export function Icon({ name }: { name: string }) {
  if (name.startsWith("/")) return <img src={name} alt="" />;
  const Lucide = lucideIcons[name];
  return Lucide ? <Lucide /> : null;
}
