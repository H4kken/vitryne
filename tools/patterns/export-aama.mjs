// SPDX-License-Identifier: AGPL-3.0-or-later
// Drafts a FreeSewing design (MIT) at the avatar's measurements and writes it as a DXF-AAMA
// (ASTM D6673) file, the way a CAD pattern system would export it:
//   one BLOCK per piece, inserted side by side in ENTITIES, R12 entities only;
//   layer 1 boundary (POLYLINE, closed) + "Piece Name:" / "Quantity:" TEXT,
//   layer 2 turn points (POINT), layer 4 notches (LINE slits), layer 6 mirror (fold) line,
//   layer 7 grain line, layer 8 internal lines (open POLYLINE). Units: mm ($INSUNITS 4).
// Seam allowance is 0, so the boundary is the sewing line.
// usage: node tools/patterns/export-aama.mjs <design> <measurements.json> <out.dxf> [part,part,...|all] [options-json]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const [design, measFile, out, only, optionsJson] = process.argv.slice(2)
const options = optionsJson ? JSON.parse(optionsJson) : {}
const m = JSON.parse(readFileSync(measFile, 'utf8'))
const measurements = Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')))
const mod = await import(path.join(here, 'node_modules/@freesewing', design, 'src/index.mjs'))
const Design = Object.values(mod).find((x) => typeof x === 'function' && x.patternConfig)
const pattern = new Design({ measurements, options, sa: 0, complete: true })
pattern.draft()
const logs = pattern.setStores[0].logs
if (logs.error.length) throw new Error(`${design}: ${JSON.stringify(logs.error)}`)
const cutlist = pattern.setStores[0].cutlist

// Internal lines worth keeping (placement lines), per part: FreeSewing marks them as help paths.
const INTERNAL = { 'hugo.front': ['pocket'] }
const FLATNESS = 0.02 // mm, max chord deviation when flattening Béziers
const TURN_DEG = 3 // tangent change that makes a joint a turn point

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a) => Math.hypot(a.x, a.y)
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

function flattenCubic(p0, p1, p2, p3, outPts) {
  // Flat enough when both control points are within FLATNESS of the chord.
  const d = sub(p3, p0)
  const l = len(d) || 1e-9
  const dist = (p) => Math.abs((p.x - p0.x) * d.y - (p.y - p0.y) * d.x) / l
  if ((dist(p1) <= FLATNESS && dist(p2) <= FLATNESS) || l < 0.05) {
    outPts.push(p3)
    return
  }
  const a = lerp(p0, p1, 0.5), b = lerp(p1, p2, 0.5), c = lerp(p2, p3, 0.5)
  const ab = lerp(a, b, 0.5), bc = lerp(b, c, 0.5), mid = lerp(ab, bc, 0.5)
  flattenCubic(p0, a, ab, mid, outPts)
  flattenCubic(mid, bc, c, p3, outPts)
}

/** Path -> { pts, joints: [{ index, angleDeg }] } in FreeSewing coordinates (mm, y down). */
function flatten(p) {
  const pts = []
  const joints = [] // vertex index at each op boundary, with incoming/outgoing tangents
  let cur = null, tin = null
  for (const op of p.ops) {
    if (op.type === 'move') {
      cur = op.to
      pts.push(cur)
      continue
    }
    if (op.type === 'close') continue
    let t0, t1
    if (op.type === 'line') {
      t0 = t1 = sub(op.to, cur)
      if (len(t0) < 1e-6) continue
      if (tin) joints.push({ index: pts.length - 1, tin, tout: t0 })
      pts.push(op.to)
    } else if (op.type === 'curve') {
      t0 = len(sub(op.cp1, cur)) > 1e-6 ? sub(op.cp1, cur) : sub(op.cp2, cur)
      t1 = len(sub(op.to, op.cp2)) > 1e-6 ? sub(op.to, op.cp2) : sub(op.to, op.cp1)
      if (tin) joints.push({ index: pts.length - 1, tin, tout: t0 })
      flattenCubic(cur, op.cp1, op.cp2, op.to, pts)
    }
    tin = t1
    cur = op.to
  }
  return { pts, joints, tin }
}

const angle = (a, b) => Math.abs((Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180) / Math.PI)

function boundary(part) {
  const { pts, joints, tin } = flatten(part.paths.seam)
  // Closed: drop the repeated start point, and add the closing joint (last -> first). If the
  // path closes with an implicit segment (`close`), its start is a joint too.
  if (len(sub(pts[0], pts[pts.length - 1])) < 1e-3) pts.pop()
  else joints.push({ index: pts.length - 1, tin, tout: sub(pts[0], pts[pts.length - 1]) })
  const n = pts.length
  const first = sub(pts[1], pts[0]), last = sub(pts[0], pts[n - 1])
  joints.push({ index: 0, tin: last, tout: first })
  const turns = joints.filter((j) => angle(j.tin, j.tout) > TURN_DEG).map((j) => j.index % n)
  return { pts, turns: [...new Set(turns)].sort((a, b) => a - b) }
}

// DXF writer (R12). FreeSewing y points down; DXF y points up.
const lines = []
// Group codes 10-59 are floats; 60-99 integers; 8 (layer) and the rest strings.
const g = (code, value) => lines.push(String(code), code >= 10 && code < 60 ? Number(value).toFixed(4) : String(value))
const P = (p) => ({ x: p.x, y: -p.y })
function polyline(layer, pts, closed) {
  g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0)
  for (const p of pts.map(P)) { g(0, 'VERTEX'); g(8, layer); g(10, p.x); g(20, p.y); g(30, 0) }
  g(0, 'SEQEND'); g(8, layer)
}
function line(layer, a, b) {
  a = P(a); b = P(b)
  g(0, 'LINE'); g(8, layer); g(10, a.x); g(20, a.y); g(30, 0); g(11, b.x); g(21, b.y); g(31, 0)
}
function point(layer, a) {
  a = P(a)
  g(0, 'POINT'); g(8, layer); g(10, a.x); g(20, a.y); g(30, 0)
}
function text(layer, a, s) {
  a = P(a)
  g(0, 'TEXT'); g(8, layer); g(10, a.x); g(20, a.y); g(30, 0); g(40, 5); g(1, s)
}

g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(0, 'ENDSEC')
g(0, 'SECTION'); g(2, 'BLOCKS')
const inserts = []
let xoff = 0
const wanted = only && only !== 'all' ? only.split(',') : null
for (const [fullName, part] of Object.entries(pattern.parts[0])) {
  if (part.hidden || !part.paths.seam) continue
  const name = fullName.split('.').pop()
  if (wanted && !wanted.includes(name)) continue
  const { pts, turns } = boundary(part)
  const cut = cutlist[fullName] ?? {}
  const qty = Object.values(cut.materials ?? {}).flat().reduce((s, c) => s + c.cut, 0) || 1
  g(0, 'BLOCK'); g(8, 1); g(2, name); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, name)
  polyline(1, pts, true)
  for (const i of turns) point(2, pts[i])
  // Notches: a 4 mm slit from the boundary into the piece.
  for (const s of Object.values(part.snippets)) {
    if (!/notch/.test(s.def)) continue
    let best = { d: Infinity }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ab = sub(b, a)
      const t = Math.max(0, Math.min(1, ((s.anchor.x - a.x) * ab.x + (s.anchor.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2 || 1)))
      const q = lerp(a, b, t), d = len(sub(q, s.anchor))
      if (d < best.d) best = { d, q, ab }
    }
    const l = len(best.ab) || 1
    let nrm = { x: -best.ab.y / l, y: best.ab.x / l }
    // Point the slit inwards: the side whose centroid offset is positive.
    const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 })
    if (nrm.x * (c.x - best.q.x) + nrm.y * (c.y - best.q.y) < 0) nrm = { x: -nrm.x, y: -nrm.y }
    line(4, best.q, { x: best.q.x + 4 * nrm.x, y: best.q.y + 4 * nrm.y })
  }
  // FreeSewing's cut list can carry a fold inherited from another part (Hugo's pocket facing):
  // only write a mirror line that the outline actually runs along.
  const onFold = cut.cutOnFold && (() => {
    const [a, b] = cut.cutOnFold, d = sub(b, a), l = len(d)
    return pts.filter((p) => Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / l < 0.5).length >= 2
  })()
  if (onFold) line(6, cut.cutOnFold[0], cut.cutOnFold[1])
  const grain = part.paths.__macro_grainline_grainline_line
  if (grain) line(7, grain.ops[0].to, grain.ops[1].to)
  else if (onFold) line(7, cut.cutOnFold[0], cut.cutOnFold[1])
  for (const pid of INTERNAL[fullName] ?? []) polyline(8, flatten(part.paths[pid]).pts, false)
  const top = pts.reduce((a, p) => (p.y < a.y ? p : a))
  text(1, { x: top.x, y: top.y + 20 }, `Piece Name: ${name}`)
  text(1, { x: top.x, y: top.y + 30 }, `Quantity: ${qty}`)
  text(1, { x: top.x, y: top.y + 40 }, `Annotation: ${fullName} from FreeSewing ${design} ${Design.designConfig?.data?.version ?? ''} (MIT)`)
  g(0, 'ENDBLK'); g(8, 1)
  const minx = Math.min(...pts.map((p) => p.x)), maxx = Math.max(...pts.map((p) => p.x))
  inserts.push({ name, x: xoff - minx })
  xoff += maxx - minx + 50
  console.error(`${name}: ${pts.length} boundary pts, ${turns.length} turn points, qty ${qty}${onFold ? ', on fold' : ''}`)
}
g(0, 'ENDSEC')
g(0, 'SECTION'); g(2, 'ENTITIES')
for (const ins of inserts) { g(0, 'INSERT'); g(8, 1); g(2, ins.name); g(10, ins.x); g(20, 0); g(30, 0) }
g(0, 'ENDSEC'); g(0, 'EOF')
writeFileSync(out, lines.join('\n') + '\n')
console.error(`wrote ${out}`)
