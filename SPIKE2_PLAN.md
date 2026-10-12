# WebGPU Garment Drape — Spike 2 Plan for Claude Code

## Context

Spike 1 (see REPORT.md and PROGRESS.md in this repo) showed:
- the browser runs the solver at 1.02–1.19× native cost with identical results;
- drape, drag and penetration targets pass with large margins on an Apple M2;
- two weaknesses fail **identically on every target**:
  - speed spikes (> 5 m/s, 1–7 frames per minute of hard dragging), caused by body creases and whipping free edges;
  - persistent self-intersections where the sleeve gets pinched between arm and torso; point-to-point repulsion can't untangle them.

**This is still a spike.** Same repo, same code, same spirit: answer a question with numbers, throwaway code is fine. The question this time:

> **Does the solver hold up on real garments, on the low-end hardware, once the crease and untangling weaknesses are fixed?**

## Pass criteria

Measured in Chrome **and** Firefox, on the M2 Mac **and** a mid-range Windows laptop with an integrated GPU, for each test garment:

| Test | Pass |
|---|---|
| Drape to rest (10–20k vertices, self-collision on) | < 3 s |
| Interactive drag | ≥ 30 fps |
| 60 s harsh random drags | 0 NaN; **no instability**: no vertex ≥ 20 m/s, and no run of more than 3 consecutive frames with a vertex ≥ 5 m/s; after the test, body penetration < 2 mm and no seam torn open (max seam gap at most 5 mm wider than at rest before the drags) |
| Body penetration at rest | max < 2 mm |
| Persistent self-intersections after rest and after the drag test | **0** in every run |
| Native vs browser | drape within 0.5 mm; browser ≤ 1.5× native |

*Changed during S3 (2026-10-12), see PROGRESS.md "S3 — criterion change": the drag test was "**0 frames** > 5 m/s", which can't tell a cloth snapping taut under a harsh pull (one frame, then it settles) from a solver blowing up. The new wording keeps the intent (no explosion) and still fails any blow-up or failure to recover.*

**Rule:** never loosen a criterion to make it pass. If a target turns out to be wrong, change it in a separate commit with the reasoning in `PROGRESS.md`, *before* the run it would affect.

## Hard rules (unchanged from spike 1)

1. WebGPU core only on every target: `Features::empty()`, `Limits::default()`. One set of WGSL shaders. WebGPU backend only in wasm.
2. Keep the spike 1 benchmarks runnable and comparable; extend them rather than replacing them.
3. Use published methods and cite the paper in a comment where each one is implemented.
4. Commit at the end of each milestone, update `PROGRESS.md` with numbers, and **stop for review** before the next milestone.
5. Refactor only when something gets in the way. No new architecture for its own sake.

## Milestones

### S1 — Low-end hardware check (1 day, partly manual)
- Run the existing bench on Firefox (Mac) and on a Windows laptop with an integrated GPU (Chrome and Firefox). The user does the Windows run and pastes the JSON.
- Fix any browser- or driver-specific problem found.
- **Done when:** numbers for all four browser × machine combinations are in `PROGRESS.md`. If Windows is > 2× slower than the M2, stop and report before continuing.

### S2 — Real patterns and a test set (3 days)
- Import patterns from **DXF-AAMA** (ASTM D6673): piece outlines, internal lines, notches, grain line. Ignore what isn't needed yet, but don't crash on it.
  - Optional alternative if it's faster: SVG export from FreeSewing or Seamly2D.
- Seam definitions and placement come from a small sidecar file per garment (`garment.toml`), since DXF doesn't carry sewing information.
- **Test set (3 garments):**
  1. T-shirt (the spike case, now from a real pattern)
  2. Straight trousers (thighs: the crease case)
  3. A garment with a collar or hood, or a button-down shirt (layered parts)
- The user provides the patterns, drafted in Seamly2D or taken from open-source pattern projects like FreeSewing. Check the licence of every pattern before committing it.
- **Done when:** all three drape on the avatar; record the numbers, including failures.

### S3 — Crease-aware body contact (4–5 days)
- Goal: remove the speed spikes and the crease pinching.
- Candidates (try in this order, measure each):
  1. **Contact velocity filter:** limit the velocity change applied by body contact per substep, with friction applied in the same pass.
  2. **Triangle-level body contact** near creases: point–triangle and edge–edge tests against the body mesh where the SDF gap is narrower than 2 × thickness + self-collision radius. Use a precomputed mask of crease regions.
  3. **Avatar pose:** a slightly wider arm–torso and thigh gap. Allowed as a pragmatic fix, but it doesn't count as solving the problem; trousers still need item 1 or 2.
- **Decided during S3:** item 1 is kept (on by default). Item 2 is deferred: the goal for now is a working engine, and accuracy comes later. Item 3 will come as an avatar morph target, which is out of scope for the spike.
- **Done when:** the drag-test criterion above (no instability) holds on the harsh drag test for all three garments, natively and in Chrome.

### S4 — Untangling pass for self-collision (4–5 days)
- Goal: 0 persistent self-intersections.
- Implement intersection-contour untangling (Baraff, Witkin & Kass 2003, "Untangling Cloth"; Volino & Magnenat-Thalmann 2006, "Resolving surface collisions through intersection contour minimization"):
  - detect intersecting triangle pairs (reuse the hash),
  - compute the intersection contour,
  - apply corrections that shrink the contour.
- Run it every N substeps, or only when the intersection count is non-zero.
- **Done when:** 0 persistent intersections after rest and after every drag run, for all three garments, on every target.

### S5 — Performance headroom (2–3 days, if time allows)
- Bending is 45–58% of GPU time with 18 graph colours. Reduce dispatches:
  - better colouring (fewer colours), and/or merge stretch and bend constraints into one coloured pass;
  - try fewer substeps × more iterations, and keep it only if quality holds.
- If the self-collision neighbour query stays the top cost, sort vertices by hash cell for better memory access.
- **Done when:** frame cost drops ≥ 30% at 10–20k vertices with self-collision on, with no quality regression.

### S6 — Report (1 day)
- Full matrix: 3 garments × {10k, 20k} × {native, Chrome, Firefox} × {Mac, Windows}.
- `REPORT.md` (spike 2 section): pass/fail per criterion, remaining weak spots, and a recommendation: is the solver ready for an editor on top, or does it need more work first?

## Out of scope

Editor UI, sewing interactions, accuracy against other tools, multi-garment outfits, rendering quality, fabric calibration, grading, the body SDF bake at scale, collaboration, server deployment, AI features.

## First message to give Claude Code

> Read SPIKE2_PLAN.md, REPORT.md and PROGRESS.md. This is spike 2, in the same repo. Start with S2, I'll check S1 myself. Follow the hard rules, especially WebGPU-default features and limits on native. After each milestone, commit, update PROGRESS.md with numbers, and stop so I can review.