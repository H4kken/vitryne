---
title: "Patent warnings"
icon: Scale
description: "Patents held by other companies, and the designs Vitryne avoids because of them."
---

<!-- Copied from docs/PATENTS.md. -->

> **What this file is, in one paragraph.** These are patents held by **other companies** (CLO
> Virtual Fashion, mostly), not by us and not ours to use. The file lists what their claims cover
> so that Vitryne can **avoid those designs**. "Avoid" means: do not build the interaction the
> claim describes. It does not mean avoid sewing, placement or measuring as features. The design
> rules below are our design-around and **override** older wording in `VITRYNE_MVP_PLAN.md`
> (written before this research) and anything an agent or contributor would otherwise assume.
> If a request or plan item conflicts with a rule here, stop and say so; do not pick the plan.

Read this before building or changing anything that joins pattern pieces, places pieces around
a body, measures a pattern, or resizes a garment.

**Status:** research notes from 2026-10-13, a lay reading of public claim text. This is **not
legal advice** and not a freedom-to-operate opinion. A patent attorney should review the design
rules below before auto-join ships. Open-source licensing (AGPL) covers copyright only; it does
not protect anyone who ships this code from patent claims.

## Why this matters

CLO Virtual Fashion (CLO 3D, Marvelous Designer) sued Style3D's developer in 2023. The case
settled in August 2026 with Style3D admitting that its software infringes the three patents in
the first table below. CLO enforces these patents.

The sources are CLO's own press release and Google Patents pages, so the settlement terms are
CLO's account only.

## Enforced patents (granted, active)

| Patent                                                             | What claim 1 requires                                                                                                                                                                         | Expires    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [US 10,733,773](https://patents.google.com/patent/US10733773B2/en) | The user picks a segment to sew, then places a start point on a second segment. A candidate end point snaps near the cursor so the two lengths match, and the length difference is displayed. | 2035-10-23 |
| [US 11,410,355](https://patents.google.com/patent/US11410355B2/en) | Same as above, plus the length or difference is shown in one colour when the lengths match and another when they do not.                                                                      | 2035-10-23 |
| [US 11,222,448](https://patents.google.com/patent/US11222448B2/en) | A measure tool on the 2D pattern. When the points fall on different pieces, the measured length is adjusted to account for the separation between pieces.                                     | 2040-09-21 |

## Granted, not enforced as far as we know

| Patent                                                             | What it covers                                                                                                                    | Expires    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [US 11,308,707](https://patents.google.com/patent/US11308707B2/en) | Automatic grading of a garment between two avatars using avatar strain ratios and a mapping between 3D garment and body portions. | 2040-08-18 |

## Pending applications (claims can still change)

| Application                                                             | Subject                                                                                                                                                                                                                                                          | Why it matters here                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [US20210227912A1](https://patents.google.com/patent/US20210227912A1/en) | Automatic determination of sewing lines. Claim 1: receive placement information matching pieces to avatar placement points, build a graph of nodes on piece outlines joined by directed segments, and use the graph to determine matching edges as sewing lines. | Closest to our auto-join. Also uses the same inputs our sidecar file already holds (where each piece starts around the body). Family filed in US, EP, CN, JP, WO, CA. |
| [US20240169632A1](https://patents.google.com/patent/US20240169632A1/en) | A neural-network model predicts arrangement points for placing pieces around a 3D avatar, then assembles and simulates.                                                                                                                                          | Applies to any ML-based automatic placement.                                                                                                                          |
| [US20240411956A1](https://patents.google.com/patent/US20240411956A1/en) | Automatic sewing simulation.                                                                                                                                                                                                                                     | **Claims not read.**                                                                                                                                                  |
| [US20230290100A1](https://patents.google.com/patent/US20230290100A1/en) | Guide for combining pattern pieces.                                                                                                                                                                                                                              | **Claims not read.**                                                                                                                                                  |

## Design rules

These are the constraints adopted for the editor so far, **binding on every editor feature**. They
override `VITRYNE_MVP_PLAN.md` where the two differ (the plan's M8 "notch-to-notch segments" was
superseded by rule 1: the unit is a whole edge). Rule 3 is the one that most needs an attorney's
review.

1. **Join whole edges only.** No start and end points on a sub-segment, no cursor snapping to
   make two lengths equal, no live colour-coded length difference while the user drags.
2. **Fix-join is "pick edge A, then edge B".** Two clicks on whole edges, not a drag along an
   edge.
3. **Derive auto-join from piece geometry** (edge length, adjacent corners, left/right
   symmetry). Do not use avatar placement points as an input, and do not build a directed
   outline graph to find sewing lines.
4. **No machine-learning placement.** Presets keep fixed, data-driven placement from the
   sidecar file.
5. **No cross-piece measure tool.** If measurements are added later, keep them within one
   piece.
6. **Fit stays parametric** (sliders on width, length, sleeve). No automatic grading based on
   avatar strain ratios.

**Decision (2026-10-14, product owner; for counsel to confirm):** an _automatic suggestion_ may
propose a seam made of a chain of runs or ending at a mid-edge `point` node (the hood's crown
seams, a sleeve cap top). The user only accepts or rejects it; they never place or drag a
sub-segment endpoint. Rule 1 still binds anything the user picks by hand: whole edges only.

**Not covered by the rules, so allowed:** a seam list showing a static length difference for an
existing whole-edge seam (see below); suggestions computed from piece geometry; picking whole
edges by two clicks; a seam highlighted in 2D and 3D.

A passive warning on a finished whole-edge pair ("these edges differ by 8%") is probably outside
the claims above, but confirm it with counsel before shipping it.

## How the editor follows these rules (M8, M14)

Where each rule is implemented, so a reviewer can check it. See ARCHITECTURE.md, "Sewing" and
"Pattern tools".

| Rule                           | In the code                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 whole edges only             | `seams.rs` `find_edge` / `join_chains` refuse any pick that is not an outline stretch between two corners; the UI offers only whole edges to click.                                               |
| 2 two clicks                   | The flat view's Sew tool: edge, then edge. Shift-click adds more whole edges to one side (a chain of whole edges, not a part of one); this is beyond "two clicks" and is on the list for counsel. |
| 3 geometry-derived suggestions | `suggest.rs`: lengths, notches, curvature, side of the piece, middle line. No placement, body place, name or outline graph.                                                                       |
| 4 no ML                        | Hand-set scores; nothing learned.                                                                                                                                                                 |
| 5 no cross-piece measure tool  | There is none. The seam list shows a length difference of an existing seam only, as text.                                                                                                         |
| 6 parametric fit               | Not touched in M8.                                                                                                                                                                                |

Drawing and editing pieces (M14) is not covered by any listed claim. Where it meets the rules:

| Rule                           | In the code                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 whole edges only             | An edited outline keeps its seams as whole-edge runs: a node a seam starts or ends on can't go without the seam (`removeNode` removes both in one command and says so); a point or notch added inside an edge leaves it whole. Sewing a drawn piece is the same Sew tool and suggestions.                                                                                                |
| 3 geometry-derived suggestions | Unchanged inputs. A run of several edges now continues only through a gentle corner (under 45°, `suggest.rs` `RUN_CORNER`), and the seam list names a drawn piece's edges by where they sit in that piece ("the right side"): both from the piece's own outline.                                                                                                                         |
| 5 no cross-piece measure tool  | Lengths and angles are shown and typed for one edge of the piece being edited or drawn (`PointBar`, `DrawBar`). The pen and the line tool snap to the grid, 15° steps and the drawn piece's own points only (`pattern/draw.ts` `snapPoint`); nothing snaps an edge to another piece's length (the core of '773). The seam list's sentence stays the only place two lengths are compared. |

## What this research did not cover

- It listed CLO's US filings (59 results on Google Patents) but read the claims of only eight.
- It did not search other companies' patents or non-US filings.
- It did no prior-art or invalidity work (the '773 priority date is 2015-10-23).
- Pending claims move. Re-check the pending applications before shipping auto-join.

## Open items

- [ ] Attorney review of rules 1 to 6 against the full claim text.
- [ ] Read the claims of US20240411956A1 and US20230290100A1.
- [ ] Wider search beyond CLO (other assignees, EP/KR/CN family members).
- [ ] Ask counsel whether the seam list's static length-difference sentence (M8) is outside the '773/'355 claims, and whether Shift-click chains of whole edges are.
- [ ] Ask counsel whether suggestions that emit chains or mid-edge points (decision above) stay outside the claims.
- [ ] Decide whether to ask counsel about a prior-art search on the '773 family.
