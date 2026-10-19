// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine as the UI sees it: one worker at a time, restarted after a crash (a panic, a
// lost GPU device) with the document put back, since the document lives in the UI. React
// reads `state` through `useEngine`.

import { useSyncExternalStore } from "react";
import { WorkerClient, WorkerCrashed } from "./client";
import {
  copyFileData,
  type DrapeInfo,
  type FileData,
  fileDataBuffers,
  type GizmoView,
  type PointerTool,
  type Requests,
  type Stats,
  type WorkerEvent,
} from "./protocol";

export interface EngineState {
  /** Changes when the worker is replaced: the viewport makes a new canvas for it. */
  generation: number;
  phase: "starting" | "ready" | "failed";
  /** Why the engine gave up (too many crashes). */
  failure: string | null;
  /** Shown once after a restart. */
  notice: string | null;
  adapter: string | null;
  stats: Stats | null;
  progress: { task: string; fraction: number } | null;
  /** The newest drape shown, and its document revision. */
  drape: { rev: number; info: DrapeInfo } | null;
  drapeError: string | null;
  /** `placing`: the cloth waits where it starts while pieces are placed. `seams`: drawn on the cloth. */
  controls: {
    fast: boolean;
    paused: boolean;
    placing: boolean;
    seams: boolean;
  };
  /** The handles of the cut asked for with `showGizmo`, on screen. */
  gizmo: GizmoView | null;
}

/** Crashes within this window count towards giving up. */
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES = 3;

export class EngineSession {
  private client: WorkerClient | null = null;
  private listeners = new Set<() => void>();
  private crashes: number[] = [];
  /** What a new worker needs to show the same thing: the file's bytes and the current JSON. */
  private restore: {
    data: FileData;
    openedEntities: string;
    entities: string;
    rev: number;
  } | null = null;
  private newestDrapeAsked = -1;
  private canvas: HTMLCanvasElement | null = null;
  private detachTimer: ReturnType<typeof setTimeout> | undefined;

  state: EngineState = {
    generation: 0,
    phase: "starting",
    failure: null,
    notice: null,
    adapter: null,
    stats: null,
    progress: null,
    drape: null,
    drapeError: null,
    // Paused at first: the drape runs once the person presses Play.
    controls: { fast: false, paused: true, placing: false, seams: false },
    gizmo: null,
  };

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  /**
   * Starts a worker on `canvas` (a new canvas per generation: control transfers once). A
   * detach followed at once by an attach of the same canvas (React's development double
   * mount) keeps the worker.
   */
  attach(canvas: HTMLCanvasElement, size: { width: number; height: number }) {
    clearTimeout(this.detachTimer);
    if (this.client && this.canvas === canvas) return;
    if (
      (canvas as HTMLCanvasElement & { __transferred?: boolean }).__transferred
    ) {
      this.set({ generation: this.state.generation + 1 });
      return;
    }
    this.canvas = canvas;
    this.client?.terminate();
    const client = new WorkerClient(canvas, size, (e) =>
      this.onEvent(client, e),
    );
    this.client = client;
    this.set({ phase: "starting" });
    const { fast, paused, placing, seams } = this.state.controls;
    if (fast || paused || placing || seams)
      client.send({ kind: "controls", fast, paused, placing, seams });
    if (this.style) client.send({ kind: "style", rgb: this.style });
    if (this.gizmoCut !== null)
      client.send({ kind: "gizmo", cut: this.gizmoCut });
    if (this.highlightCut !== null)
      client.send({ kind: "highlight", cut: this.highlightCut });
    if (this.highlightedSeam !== null)
      client.send({ kind: "highlightSeam", seam: this.highlightedSeam });
    if (this.restore) void this.reopen(client, this.restore);
  }

  detach() {
    clearTimeout(this.detachTimer);
    this.detachTimer = setTimeout(() => {
      this.client?.terminate();
      this.client = null;
      this.canvas = null;
      this.set({ generation: this.state.generation + 1 });
    }, 0);
  }

  private onEvent(client: WorkerClient, e: WorkerEvent) {
    if (client !== this.client) return;
    switch (e.kind) {
      case "ready":
        this.set({ phase: "ready", adapter: e.adapter });
        return;
      case "stats":
        this.set({ stats: e.stats });
        return;
      case "progress":
        this.set({
          progress:
            e.fraction >= 1 ? null : { task: e.task, fraction: e.fraction },
        });
        return;
      case "picked":
        for (const cb of this.pickListeners) cb(e.cut);
        return;
      case "gizmo":
        this.set({ gizmo: e.gizmo });
        return;
      case "crashed":
        this.crashed(e.reason);
        return;
    }
  }

  private pickListeners = new Set<(cut: number) => void>();

  /** The select tool's picks: a panel index of the shown drape (`DrapeInfo.cuts`), or -1. */
  onPicked(cb: (cut: number) => void): () => void {
    this.pickListeners.add(cb);
    return () => this.pickListeners.delete(cb);
  }

  private crashed(reason: string) {
    console.error("engine worker crashed:", reason);
    const now = Date.now();
    this.crashes = [
      ...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS),
      now,
    ];
    this.client = null;
    if (this.crashes.length >= MAX_CRASHES) {
      this.set({ phase: "failed", failure: reason, progress: null });
      return;
    }
    // A new canvas mounts for the new generation and calls `attach`.
    this.set({
      generation: this.state.generation + 1,
      phase: "starting",
      progress: null,
      gizmo: null,
      notice: `The 3D engine stopped (${reason}) and was restarted. Your document is unchanged.`,
    });
  }

  private async reopen(
    client: WorkerClient,
    r: NonNullable<EngineSession["restore"]>,
  ) {
    try {
      const data = copyFileData(r.data);
      await client.request("open", { data }, fileDataBuffers(data));
      if (r.entities !== r.openedEntities)
        await client.request("update", { rev: r.rev, entities: r.entities });
      this.drape(r.rev, true);
      for (const cb of this.reopenedListeners) cb();
    } catch (e) {
      // A crash during the reopen is handled as a crash; other errors are shown.
      if (client.alive) this.set({ drapeError: String((e as Error).message) });
    }
  }

  private need(): WorkerClient {
    if (!this.client) throw new WorkerCrashed("the 3D engine is restarting");
    return this.client;
  }

  private reopenedListeners: (() => void)[] = [];

  onReopened(cb: () => void) {
    this.reopenedListeners.push(cb);
  }

  clearNotice() {
    this.set({ notice: null });
  }

  // ---- the document ---------------------------------------------------------------------

  /** Opens a `.vtry`; the worker keeps the binary parts, the UI gets the JSON. */
  async open(data: FileData, rev: number): Promise<Requests["open"]["reply"]> {
    const copy = copyFileData(data);
    const sent = copyFileData(data);
    const reply = await this.need().request(
      "open",
      { data: sent },
      fileDataBuffers(sent),
    );
    this.restore = {
      data: copy,
      openedEntities: reply.entities,
      entities: reply.entities,
      rev,
    };
    this.set({ drape: null, drapeError: null });
    return reply;
  }

  /** Nothing to put back after a restart any more. */
  closeDocument() {
    this.restore = null;
    this.set({ drape: null, drapeError: null, progress: null });
  }

  /** Validates and takes the document's new JSON (see `Requests.update`). */
  async update(
    rev: number,
    entities: string,
  ): Promise<Requests["update"]["reply"]> {
    const reply = await this.need().request("update", { rev, entities });
    // Only what Rust accepted is put back after a restart.
    if (this.restore) this.restore = { ...this.restore, entities, rev };
    return reply;
  }

  /** Re-drapes; only the newest revision's result is shown. */
  drape(rev: number, frameCamera: boolean) {
    this.newestDrapeAsked = Math.max(this.newestDrapeAsked, rev);
    const client = this.client;
    if (!client) return;
    client.request("drape", { rev, frameCamera }).then(
      (r) => {
        if (r.stale || r.rev < this.newestDrapeAsked || client !== this.client)
          return;
        this.set({ drape: { rev: r.rev, info: r.info }, drapeError: null });
      },
      (e: Error) => {
        if (
          rev >= this.newestDrapeAsked &&
          client === this.client &&
          client.alive
        ) {
          this.set({ drape: null, drapeError: e.message, progress: null });
        }
      },
    );
  }

  /**
   * A new project from a DXF (see `Requests.importNew`): it becomes the worker's document, and
   * the file it made is what a restarted worker reopens.
   */
  async importNew(
    args: Requests["importNew"]["args"],
    rev: number,
  ): Promise<{ entities: string; notes: string[]; zip: ArrayBuffer }> {
    return this.made(
      await this.need().request("importNew", args, [args.avatar]),
      rev,
    );
  }

  /** A project from scratch (see `Requests.newEmpty`), made like `importNew`. */
  async newEmpty(
    args: Requests["newEmpty"]["args"],
    rev: number,
  ): Promise<{ entities: string; notes: string[]; zip: ArrayBuffer }> {
    return this.made(
      await this.need().request("newEmpty", args, [args.avatar]),
      rev,
    );
  }

  /** A project the worker made is its document now; a restarted worker reopens its file. */
  private made(
    reply: Requests["importNew"]["reply"],
    rev: number,
  ): Requests["importNew"]["reply"] {
    this.restore = {
      data: { form: "zip", bytes: reply.zip.slice(0) },
      openedEntities: reply.entities,
      entities: reply.entities,
      rev,
    };
    this.set({ drape: null, drapeError: null });
    return reply;
  }

  async inspectDxf(
    name: string,
    dxf: string,
    sidecar: string,
  ): Promise<string> {
    return (await this.need().request("inspectDxf", { name, dxf, sidecar }))
      .preview;
  }

  async importAddition(
    args: Requests["importAddition"]["args"],
  ): Promise<string> {
    return (await this.need().request("importAddition", args)).addition;
  }

  async rewrap(cut: string, place: string): Promise<string> {
    return (await this.need().request("rewrap", { cut, place })).rewrapped;
  }

  /** A drawn piece wrapped around the body (`project::PlacedPiece`, JSON). */
  async placePiece(piece: string, places: string[]): Promise<string> {
    return (await this.need().request("placePiece", { piece, places })).placed;
  }

  /** Every whole edge of every cut (`seams::CutEdge[]`, JSON). */
  async sewingEdges(): Promise<string> {
    return (await this.need().request("sewingEdges", {})).edges;
  }

  /** Suggested seams (`seams::SeamProposal[]`, JSON): the user accepts or rejects each. */
  async suggestSeams(): Promise<string> {
    return (await this.need().request("suggestSeams", {})).proposals;
  }

  /** The seam two whole edges make (`seams::SeamProposal`, JSON); a pick that isn't a whole edge is refused. */
  async joinEdges(a: string, b: string): Promise<string> {
    return (await this.need().request("joinEdges", { a, b })).proposal;
  }

  /** Each seam's length difference in percent, by seam id (JSON). */
  async seamDifferences(): Promise<string> {
    return (await this.need().request("seamDifferences", {})).differences;
  }

  /** The worker's document as a file (validated and read back in Rust). */
  async save(rev: number, form: FileData["form"]): Promise<FileData> {
    const { data } = await this.need().request("save", { rev, form });
    // What a restarted worker reopens from now on.
    if (this.restore)
      this.restore = {
        data: copyFileData(data),
        openedEntities: this.restore.entities,
        entities: this.restore.entities,
        rev,
      };
    return data;
  }

  /** glTF 2.0 binary (.glb) export of the draped garment, with UVs and PBR materials. */
  /** The drape now as a small image, for the project's thumbnail. */
  async thumbnail(
    width: number,
    height: number,
  ): Promise<{ image: ArrayBuffer; type: string }> {
    return await this.need().request("thumbnail", { width, height });
  }

  async exportGlb(includeAvatar = false): Promise<ArrayBuffer> {
    const { glb } = await this.need().request("exportGlb", { includeAvatar });
    return glb;
  }

  /** The garment's pieces as DXF-AAMA (sewing lines, no seam allowance), with the export's notes. */
  async exportDxf(): Promise<{ text: string; notes: string[] }> {
    return await this.need().request("exportDxf", {});
  }

  /** Wavefront OBJ (.obj + .mtl) export of the draped garment, with UVs and PBR materials. */
  async exportObj(
    includeAvatar = false,
  ): Promise<{ obj: string; mtl: string }> {
    return await this.need().request("exportObj", { includeAvatar });
  }

  // ---- inputs ---------------------------------------------------------------------------

  resize(width: number, height: number) {
    this.client?.send({ kind: "resize", width, height });
  }

  pointer(
    phase: "down" | "move" | "up",
    x: number,
    y: number,
    px: number,
    py: number,
    tool?: PointerTool,
  ) {
    this.client?.send({ kind: "pointer", phase, x, y, px, py, tool });
  }

  private style: number[] | null = null;

  /** The scene's colours; kept and sent again to a restarted worker. */
  setStyle(rgb: number[]) {
    this.style = rgb;
    this.client?.send({ kind: "style", rgb });
  }

  wheel(steps: number) {
    this.client?.send({ kind: "wheel", steps });
  }

  /** Turns the camera, as a pointer drag of (`dx`, `dy`) px would. */
  orbit(dx: number, dy: number) {
    this.client?.send({ kind: "orbit", dx, dy });
  }

  setControls(c: Partial<EngineState["controls"]>) {
    this.set({ controls: { ...this.state.controls, ...c } });
    this.client?.send({ kind: "controls", ...c });
  }

  resetDrape() {
    this.client?.send({ kind: "controls", reset: true });
  }

  private gizmoCut: number | null = null;

  /** Report the handles of this cut (a panel index of the shown drape), or none. */
  showGizmo(cut: number | null) {
    if (cut === this.gizmoCut) return;
    this.gizmoCut = cut;
    if (cut === null) this.set({ gizmo: null });
    this.client?.send({ kind: "gizmo", cut });
  }

  private highlightCut: string | null = null;

  /** Picks out this cut (its id) on the cloth, the others faded; or none. */
  highlight(cut: string | null) {
    if (cut === this.highlightCut) return;
    this.highlightCut = cut;
    this.client?.send({ kind: "highlight", cut });
  }

  private highlightedSeam: number | null = null;

  /** Draws this seam (its index in the garment's seams) alone on the cloth; or none. */
  highlightSeam(seam: number | null) {
    if (seam === this.highlightedSeam) return;
    this.highlightedSeam = seam;
    this.client?.send({ kind: "highlightSeam", seam });
  }

  /** Shows a cut at a placement while its handle is dragged (no edit yet). */
  placeCut(cut: number, placement: unknown) {
    this.client?.send({
      kind: "place",
      cut,
      placement: JSON.stringify(placement),
    });
  }
}

export function useEngine(session: EngineSession): EngineState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
