// SPDX-License-Identifier: AGPL-3.0-or-later
// The pages (`content/docs/**/*.mdx`) and the sidebar order (`meta.json` per folder).
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { isIconName } from "@/lib/icons";

const icon = z
  .string()
  .refine(isIconName, "not an icon in src/lib/icons.ts, nor an image path")
  .optional();

const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    icon,
  }),
});

const meta = defineCollection({
  loader: glob({ pattern: "**/*.{json,yaml}", base: "./content/docs" }),
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    pages: z.array(z.string()).optional(),
    icon,
  }),
});

export const collections = { docs, meta };
