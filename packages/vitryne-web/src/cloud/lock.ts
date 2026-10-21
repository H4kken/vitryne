// SPDX-License-Identifier: AGPL-3.0-or-later
// One tab edits a cloud project at a time, in this browser (Web Locks): two tabs autosaving the
// same project would only conflict. The tab that opens a project another tab has asks first; it
// can take it over (`steal`), and the other tab is told. Another browser or device is caught by
// the revision check instead (projects.ts). Without Web Locks every tab may edit.

const name = (id: string) => `vitryne-project:${id}`;

export class ProjectLock {
  private release: (() => void) | null = null;
  /** Bumped by every take and drop: a stale lock's loss isn't reported. */
  private turn = 0;

  /**
   * Holds the lock on project `id` (dropping any other). False when another tab holds it and
   * `steal` is false; `lost` runs if another tab takes it over later.
   */
  async take(id: string, steal: boolean, lost: () => void): Promise<boolean> {
    this.drop();
    const turn = this.turn;
    if (typeof navigator === "undefined" || !navigator.locks) return true;
    // A lock this page just dropped (a re-render, a reopen) can take a moment to be free.
    for (let attempt = 0; ; attempt++) {
      const got = await this.request(id, steal, turn, lost);
      if (got || attempt === 2 || turn !== this.turn)
        return got && turn === this.turn;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private request(
    id: string,
    steal: boolean,
    turn: number,
    lost: () => void,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const held = new Promise<void>((r) => (this.release = r));
      navigator.locks
        .request(
          name(id),
          steal ? { steal: true } : { ifAvailable: true },
          (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            resolve(true);
            return held;
          },
        )
        .catch(() => {
          // Taken over by another tab (an AbortError), or never granted.
          resolve(false);
          if (turn === this.turn) {
            this.release = null;
            lost();
          }
        });
    });
  }

  drop() {
    this.turn++;
    this.release?.();
    this.release = null;
  }
}
