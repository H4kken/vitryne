// SPDX-License-Identifier: AGPL-3.0-or-later
// The sample projects bundled with the app (`drape export-app-assets`).

export interface Example {
  file: string;
  title: string;
  sdfKey: string;
}

export async function listExamples(): Promise<Example[]> {
  const r = await fetch(`${import.meta.env.BASE_URL}examples/index.json`);
  if (!r.ok) throw new Error('the examples are missing (run `npm run assets`)');
  return (await r.json()) as Example[];
}

export async function fetchExample(e: Example): Promise<ArrayBuffer> {
  const r = await fetch(`${import.meta.env.BASE_URL}${e.file}`);
  if (!r.ok) throw new Error(`${e.file}: ${r.status} ${r.statusText}`);
  return r.arrayBuffer();
}
