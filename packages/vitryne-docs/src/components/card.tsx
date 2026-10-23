// SPDX-License-Identifier: AGPL-3.0-or-later
// Fumadocs' card, with its icon given by name (`<Card icon="Rocket" ...>`, lib/icons.ts) so
// an MDX page can pass one; an unknown name fails the build.
import {
  Card as FumadocsCard,
  type CardProps,
} from "fumadocs-ui/components/card";
import { isIconName } from "@/lib/icons";
import { Icon } from "./icon";

export function Card({
  icon,
  ...props
}: Omit<CardProps, "icon"> & { icon?: string }) {
  if (icon !== undefined && !isIconName(icon))
    throw new Error(
      `Card icon "${icon}": not an icon in src/lib/icons.ts, nor an image path`,
    );
  return (
    <FumadocsCard icon={icon ? <Icon name={icon} /> : undefined} {...props} />
  );
}
