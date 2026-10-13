// SPDX-License-Identifier: AGPL-3.0-or-later
// Checked before the engine worker starts, so a browser without WebGPU gets a clear message
// instead of a failed worker. There is no WebGL fallback, by design.

export type GpuCheck = { ok: true } | { ok: false; reason: string };

export async function checkWebGpu(): Promise<GpuCheck> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return { ok: false, reason: 'This browser has no WebGPU.' };
  if (typeof OffscreenCanvas === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) {
    return { ok: false, reason: 'This browser cannot draw from a worker (no OffscreenCanvas).' };
  }
  try {
    if (!(await gpu.requestAdapter())) return { ok: false, reason: 'WebGPU found no usable GPU on this device.' };
  } catch (e) {
    return { ok: false, reason: `WebGPU failed to start: ${(e as Error).message}` };
  }
  return { ok: true };
}

export const SUPPORTED_BROWSERS =
  'Chrome or Edge 113 or later, Safari 26 or later, or Firefox 141 or later on Windows (and on macOS from Firefox 145)';
