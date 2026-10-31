---
title: "Patent warnings"
icon: Scale
description: "Patents held by other companies, what each claim requires, and the one element of each that Vitryne never implements."
---

> **What this file is, in one paragraph.** These are patents held by **other companies** (CLO
> Virtual Fashion, all of them so far), not by us and not ours to use. Each claim lists elements,
> and a claim only applies to a product that has **every one** of them. So for each document
> below this file records what claim 1 requires and the one element Vitryne never implements.
> Features that lack that element are allowed, even when they use the other elements. The design
> rules are that list of elements to avoid; they **override** older wording in
> `VITRYNE_MVP_PLAN.md` (written before this research) and anything an agent or contributor would
> otherwise assume. If a request or plan item has all the elements of a claim, stop and say so;
> do not pick the plan.

Read this before building or changing anything that joins pattern pieces, places pieces around
a body, measures a pattern, or resizes a garment.

**Status:** research notes from 2026-10-13, re-read against the claim text on 2026-10-30 (claim 1
of every document below, and the other independent claims). A lay reading of public claim text.
This is **not legal advice** and not a freedom-to-operate opinion. A patent attorney should
review the design rules below before auto-join ships. Open-source licensing (AGPL) covers
copyright only; it does not protect anyone who ships this code from patent claims.

## Why this matters

CLO Virtual Fashion (CLO 3D, Marvelous Designer) sued Style3D's developer in 2023. The case
settled in August 2026 with Style3D admitting that its software infringes the three patents in
the first table below. CLO enforces these patents. Google Patents marks the same three with
"first worldwide family litigation filed".

The sources are CLO's own press release and Google Patents pages, so the settlement terms are
CLO's account only.

**Why a US patent matters to us.** Nothing obliges anyone to follow this file; it is how the
project manages risk. A US patent is enforceable against making, using, selling or importing in
the United States. Vitryne's editor runs in the browser, so a US visitor using it is a use in
the US, and a US-hosted backend is another. Most of the documents below also have family members in EP, CN,
JP, WO, CA or KR, which are separate patents with their own claims. A patent that has
not been granted cannot be enforced yet, but its claims can still change before grant.

## How to read the tables

- A claim reads on a product only if the product has **all** of the claim's elements. A product
  that never does one of them stays outside that claim. Each document below lists the elements
  and the one we never implement.
- The **other independent claims** (apparatus and storage-medium forms) repeat the same elements
  as claim 1 in all of the documents read, so the same avoided element covers them.
- This is a literal reading. Courts also look at **equivalents** (a different way of doing the
  same thing), and a **continuation** can claim a different subset of the same description.
  Where a rule below rests on one element, a feature that reproduces that element in other words
  is still the element. Counsel should confirm this reading.
- Only the US text was read. The EP, CN, JP, WO and CA family members were not.

## Enforced patents (granted, active)

| Patent                                                             | Granted    | Expires               | Claim 1 requires (every element)                                                                                                                                                                                                                                                                                                                                                                                                                        | The element we never implement                                                                                                    |
| ------------------------------------------------------------------ | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [US 10,733,773](https://patents.google.com/patent/US10733773B2/en) | 2020-08-04 | 2036-06-29 (adjusted) | A first segment is selected to be sewn. On a second segment the user inputs a starting point; a present point follows the cursor; a candidate ending point is displayed that makes the second length substantially equal to the first; the present point moves to the candidate when it is near; the difference between the two lengths is displayed; a user input selects the end point; the section between start and end becomes the second segment. | **Moving the user's seam end point to the position that makes the two lengths equal.** Without that snap, claim 1 does not apply. |
| [US 11,410,355](https://patents.google.com/patent/US11410355B2/en) | 2022-08-09 | 2035-10-23            | A continuation of the above. Same start point, cursor-following present point and **move to a candidate ending point that makes the lengths substantially equal**, and the length or difference is displayed in one colour when equal and another when not equal.                                                                                                                                                                                       | The same equal-length snap. Colouring the numbers is not claimed on its own.                                                      |
| [US 11,222,448](https://patents.google.com/patent/US11222448B2/en) | 2022-01-11 | 2040-09-21            | A measure tool on the 2D pattern: receive points; determine whether the points are in the same pattern piece or different ones; determine the length of the segment, **changed to account for the separation between the pieces** when they are in different pieces; output it.                                                                                                                                                                         | **Correcting a length measured between two pieces for the gap between them** (and deciding by piece which formula to use).        |

## Granted, not enforced as far as we know

| Patent                                                             | Granted    | Expires    | Claim 1 requires (every element)                                                                                                                                                                                                                                                                                                                                                                                                                           | The element we never implement                                                                                                                   |
| ------------------------------------------------------------------ | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [US 11,308,707](https://patents.google.com/patent/US11308707B2/en) | 2022-04-19 | 2040-08-18 | Automatic grading: determine **avatar strain ratios** (differences between polygons of a source avatar's mesh and a target avatar's mesh); determine mapping relationships between parts of the 3D source garment and the source avatar's body portions; determine the 2D target patterns by processing both, including a second strain rate of a target pattern candidate and an **optimisation algorithm** that restrains its difference from the first. | **Grading by avatar-to-avatar strain ratios and an optimisation.** Grading from a size chart, parametric sliders or a rule table is not claimed. |
| [US 12,125,162](https://patents.google.com/patent/US12125162B2/en) | 2024-10-22 | 2040-09-21 | A guide for combining pieces (application US20230290100A1, granted with the same claims): the user selects a point on piece A and a point on piece B; **a replicated copy of piece A is generated**, its corresponding point is identified, and the replica is displayed rotated or moved so that its point meets the point on piece B (claim 20: and rotated so the normals at the two points are parallel).                                              | **A replica (ghost) of a piece that is moved to meet a point picked on another piece.** Moving or highlighting the real piece is not that.       |

## Pending applications (claims can still change)

| Application                                                             | Claim 1 requires (every element)                                                                                                                                                                                                                                                                                                                   | The element we never implement                                                                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [US20210227912A1](https://patents.google.com/patent/US20210227912A1/en) | Automatic sewing lines: (a) **placement information matching the pieces to placement points of an avatar**; (b) a **graph** of nodes on the pieces' outlines with directed segments between adjacent nodes; (c) matching edges identified by the placement information determined as sewing lines using the graph. Family: US, EP, CN, JP, WO, CA. | **Using placement information as an input to find sewing lines.** (An outline made of nodes and edges is how the file format itself works, so (b) alone is not avoidable and is not the problem.) |
| [US20240169632A1](https://patents.google.com/patent/US20240169632A1/en) | Automatic arrangement: receive pattern information; apply it to a **neural network model** that extracts features and **predicts arrangement points** relative to a 3D avatar; arrange the patterns there; assemble them into the garment; simulate. Family: US, EP.                                                                               | **A neural network that predicts where pieces go.** Hand-set rules and the person's own choice are not claimed.                                                                                   |
| [US20240411956A1](https://patents.google.com/patent/US20240411956A1/en) | Automatic sewing simulation: obtain pieces and placement information; the user's input generates **pattern blocks** from the pieces; a **sewing tag** is generated for the blocks; **automatic sewing is performed between blocks based on the tag**. Family: US, WO, CN, EP, KR.                                                                  | **A user-chosen piece type or block that generates tags which drive automatic sewing.**                                                                                                           |

## Design rules

These are the constraints adopted for the editor, **binding on every editor feature**. Each is
the element of a claim above that Vitryne never implements; they override `VITRYNE_MVP_PLAN.md`
where the two differ (the plan's sewing by "notch-to-notch segments" was superseded by rule 1).
The numbers are used in code comments and other pages; keep them. Rule 3 is the one that most
needs an attorney's review.

1. **Never snap a seam end the user placed to an equal-length position** ('773, '355). No end
   point that jumps to where the two sides of a seam have the same length, whatever else is shown.
2. **No replica of a piece moved to a point picked on another piece** ('162). Fix-join stays
   "pick edge A, then edge B" and shows nothing while the person picks.
3. **Never feed placement into sewing, and never turn a piece type into automatic sewing**
   ('912, '956). Auto-join is derived from piece geometry (edge length, adjacent corners,
   left/right symmetry, notches); it does not read the avatar placement points, the body place a
   piece was given or any name-derived role. Where a piece goes on the body is a position only,
   never a type or tag that decides seams.
4. **No learned model predicting placement** ('632). Presets keep fixed, data-driven placement
   from the sidecar file; the import suggests a place from the piece's name with hand-set rules
   and the person decides.
5. **No correction of a cross-piece length for the gap between pieces** ('448). A measure tool
   within one piece is free. A length between points on different pieces may only be the plain
   straight-line distance between the points as drawn, with no test of whether they are in the
   same piece and no adjustment for the separation.
6. **No grading from avatar strain ratios and an optimisation** ('308). Fit stays parametric
   (sliders on width, length, sleeve), from size charts or from grade rules.

**Design choices that are stricter than the rules, and stay.** The rules above are all the
patents need; the editor does more than that on purpose, to stay well away from the claims:
seams are **whole edges** picked by **two clicks** (so there is no start point on a segment at
all), nothing is measured or compared while the person picks, and suggestions use no placement.
A feature that is free under the rules (a sub-edge seam end placed by hand without a snap, a
live length difference without a snap, a plain cross-piece distance) is allowed, but should be
checked against this file first and logged under Open items so counsel sees it.

**Decision (2026-10-14, product owner; for counsel to confirm):** an _automatic suggestion_ may
propose a seam made of a chain of runs or ending at a mid-edge `point` node (the hood's crown
seams, a sleeve cap top). The user only accepts or rejects it; they never place or drag a
sub-segment endpoint.

**Not covered by the rules, so allowed:** a seam list showing a static length difference for an
existing seam (no snap was involved, so '773 and '355 lack their key element); suggestions
computed from piece geometry; picking whole edges by two clicks; a seam highlighted in 2D and
3D; placing pieces by the person's own drag and drop on the body, with suggestions from piece
names; a size chart's own sizes.

A passive warning on a finished seam ("these edges differ by 8%") lacks the snap that '773 and
'355 require, so it is outside their claims as read here. It is still on the list for counsel.

## How the editor follows these rules

Where each rule is implemented, so a reviewer can check it. See the [Architecture](/developers/architecture) page, "Sewing" and
"Pattern tools".

| Rule                               | In the code                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 no equal-length snap             | `seams.rs` `find_edge` / `join_chains` refuse any pick that is not an outline stretch between two corners; the UI offers only whole edges to click. There is no end point to snap.                          |
| 2 no replica, two clicks           | The flat view's Sew tool: edge, then edge, and nothing moves or is drawn while picking. Shift-click adds more whole edges to one side (a chain of whole edges, not a part of one); on the list for counsel. |
| 3 geometry-derived suggestions     | `suggest.rs`: lengths, notches, curvature, side of the piece, middle line. No placement, body place, name or role. Placement zones (the body map, the 3D drop, the finer places) are positions only.        |
| 4 no ML                            | Hand-set scores and name rules; nothing learned.                                                                                                                                                            |
| 5 no cross-piece length correction | There is no cross-piece measure tool. The seam list shows a length difference of an existing seam only, as text.                                                                                            |
| 6 parametric fit                   | Not touched.                                                                                                                                                                                                |

The import flow (since 2026-10-31) places pieces by dropping them on a body map or the avatar,
and keeps pieces off the body with a cut `state` (`unplaced`, `set-aside`; format version 6). How
it meets rule 3:

- A zone, a finer place (`Landmark`: it only changes a wrap's `top`) and `state` are positions and
  flags the person sets. No code in `suggest.rs` or `seams.rs` reads them: sewing uses the whole
  document, while only the 3D drape leaves out unplaced and set-aside cuts (`project::for_drape`).
- The Seams tab opens with suggestions once the last waiting piece is placed. That is the order
  of the screens, not an input: the suggestions are the same whenever they are asked for.
- Piece names suggest a place (rule 4: fixed name rules). They are never read by sewing, and no
  piece type drives automatic sewing.

Importing a Valentina pattern joins nothing and places pieces as a DXF import does (the user's
choice of place, suggested from names, rule 4); its sewing comes from the same suggestions and
Sew tool (rules 1 to 3). Picking a size of the pattern's own size chart works out the author's
formulas at that size: no grading from avatar strain (rule 6), and no measure tool (rule 5).

Drawing and editing pieces is not covered by any listed claim. Where it meets the rules:

| Rule                               | In the code                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 no equal-length snap             | An edited outline keeps its seams as whole-edge runs: a node a seam starts or ends on can't go without the seam (`removeNode` removes both in one command and says so); a point or notch added inside an edge leaves it whole. Sewing a drawn piece is the same Sew tool and suggestions.                                                                                                |
| 3 geometry-derived suggestions     | Unchanged inputs. A run of several edges now continues only through a gentle corner (under 45°, `suggest.rs` `RUN_CORNER`), and the seam list names a drawn piece's edges by where they sit in that piece ("the right side"): both from the piece's own outline.                                                                                                                         |
| 5 no cross-piece length correction | Lengths and angles are shown and typed for one edge of the piece being edited or drawn (`PointBar`, `DrawBar`). The pen and the line tool snap to the grid, 15° steps and the drawn piece's own points only (`pattern/draw.ts` `snapPoint`); nothing snaps an edge to another piece's length (the core of '773). The seam list's sentence stays the only place two lengths are compared. |

## What this research did not cover

- It listed CLO's US filings (59 results on Google Patents) but read the claims of only nine
  documents: the ones above.
- It did not search other companies' patents or non-US filings, and read no EP, CN, JP, WO or CA
  family member.
- It did no prior-art or invalidity work (the '773 family's earliest filing is 2015-10-23).
- Pending claims move, and a continuation of a granted patent can claim a different subset.
  Re-check the pending applications before shipping auto-join, and check US12125162B2's family
  for continuations.

## Open items

- [ ] Attorney review of rules 1 to 6 against the full claim text, including the equivalents
      question for rule 1 (a snap to a notch or a corner instead of an equal length).
- [x] Read the claims of US20240411956A1 and US20230290100A1 (2026-10-30). The second was
      granted on 2024-10-22 as US 12,125,162 B2 with the same claims; it is in the second table.
- [ ] Wider search beyond CLO (other assignees, EP/KR/CN family members).
- [ ] Ask counsel whether the seam list's static length-difference sentence is outside the '773/'355 claims, and whether Shift-click chains of whole edges are.
- [ ] Ask counsel whether suggestions that emit chains or mid-edge points (decision above) stay outside the claims.
- [ ] Ask counsel whether the placement zones of the import (positions chosen by the person, suggested from names) stay outside US20240411956A1's "pattern block" and "sewing tag".
- [ ] Ask counsel whether the order of the new import (place the pieces, then the Seams tab opens
      with suggestions that don't read placement) can be read as US20210227912A1's or
      US20240411956A1's "based on placement information", though no placement is an input.
- [ ] Decide whether to ask counsel about a prior-art search on the '773 family.
