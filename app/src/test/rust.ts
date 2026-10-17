// SPDX-License-Identifier: AGPL-3.0-or-later
// The worker's Rust (drape-web's VtryFile, built for Node by `pnpm run wasm`) and the example
// projects (`pnpm run assets`), for tests: the same validation and writer as the app.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as Wasm from "../../pkg-node/drape_web";
import { type Entities, parseEntities } from "@/document/entities";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");

function load(): typeof Wasm {
  try {
    return require(resolve(root, "pkg-node/drape_web.js")) as typeof Wasm;
  } catch (e) {
    throw new Error(
      `pkg-node missing: run \`pnpm run wasm\` (${(e as Error).message})`,
      { cause: e },
    );
  }
}

export const wasm = load();

export const EXAMPLES = ["tshirt", "trousers", "hoodie"] as const;

export function exampleZip(name: string): Uint8Array {
  try {
    return new Uint8Array(
      readFileSync(resolve(root, `public/examples/${name}.vtry`)),
    );
  } catch (e) {
    throw new Error(
      `public/examples/${name}.vtry missing: run \`pnpm run assets\``,
      { cause: e },
    );
  }
}

export function openExample(name: string): {
  file: Wasm.VtryFile;
  zip: Uint8Array;
  entities: Entities;
} {
  const zip = exampleZip(name);
  const file = wasm.VtryFile.open(zip);
  return { file, zip, entities: parseEntities(file.entities()) };
}

/** Rust's verdict on a state: null if accepted, else why not. */
export function rustRefuses(file: Wasm.VtryFile, e: Entities): string | null {
  try {
    file.set_entities(JSON.stringify(e));
    return null;
  } catch (err) {
    return String(err);
  }
}
