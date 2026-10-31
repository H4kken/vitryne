// SPDX-License-Identifier: AGPL-3.0-or-later
// The icons a page (`icon:` in its front matter), a folder (`"icon"` in its meta.json) or a
// card (`<Card icon="...">`) can show: a Lucide name from this list, or an image under public/
// (`/icons/x.svg`) for a logo. Only the icons listed here are bundled; add one here to use it.
// The content schemas (content.config.ts) and the card reject anything else.
import {
  ArrowRightLeft,
  Blocks,
  BookOpen,
  ChartLine,
  ClipboardCheck,
  Cloud,
  Code,
  Container,
  Database,
  Download,
  FileCode,
  GitMerge,
  Globe,
  House,
  LifeBuoy,
  Palette,
  PanelsLeftBottom,
  PanelTopOpen,
  RefreshCw,
  Rocket,
  Scale,
  ScrollText,
  Server,
  Settings,
  Shirt,
  Sigma,
  Upload,
  type LucideIcon,
} from "lucide-react";

export const lucideIcons: Record<string, LucideIcon> = {
  ArrowRightLeft,
  Blocks,
  BookOpen,
  ChartLine,
  ClipboardCheck,
  Cloud,
  Code,
  Container,
  Database,
  Download,
  FileCode,
  GitMerge,
  Globe,
  House,
  LifeBuoy,
  Palette,
  PanelsLeftBottom,
  PanelTopOpen,
  RefreshCw,
  Rocket,
  Scale,
  ScrollText,
  Server,
  Settings,
  Shirt,
  Sigma,
  Upload,
};

export function isIconName(icon: string): boolean {
  return icon in lucideIcons || /^\/[\w./-]+\.(svg|png|webp)$/.test(icon);
}
