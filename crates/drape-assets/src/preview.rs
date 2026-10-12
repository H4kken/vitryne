//! SVG of a meshed pattern for inspection: triangles, seams colour-coded and named, and
//! optional labelled points per panel (garment landmarks, for writing `garment.toml`).

use glam::Vec2;

use crate::{meshing::MeshedPattern, pattern::Pattern};

/// `labels[panel]`: (pattern point, text) drawn as a dot with its text.
pub fn pattern_svg(pat: &Pattern, mp: &MeshedPattern, labels: &[Vec<(Vec2, String)>], title: &str) -> String {
    let scale = 1000.0; // 1 px per mm
    // Shelf layout: panels left to right, wrapping so the page comes out roughly square.
    let mut offsets = Vec::new();
    let (mut x, mut y, mut row_h, mut width) = (20.0f32, 40.0f32, 0.0f32, 0.0f32);
    let bounds: Vec<(Vec2, Vec2)> = pat
        .panels
        .iter()
        .map(|p| p.outline().iter().fold((Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)), |(lo, hi), q| (lo.min(*q), hi.max(*q))))
        .collect();
    let area: f32 = bounds.iter().map(|(lo, hi)| ((*hi - *lo) * scale + 40.0).element_product()).sum();
    let widest = bounds.iter().map(|(lo, hi)| (hi.x - lo.x) * scale).fold(0.0, f32::max);
    let wrap = (area.sqrt() * 1.15).max(widest + 40.0);
    for (lo, hi) in &bounds {
        let size = (*hi - *lo) * scale;
        if x + size.x > wrap && x > 20.0 {
            x = 20.0;
            y += row_h + 40.0;
            row_h = 0.0;
        }
        // Pattern y is up; SVG y is down.
        offsets.push(Vec2::new(x - lo.x * scale, y + hi.y * scale));
        x += size.x + 40.0;
        row_h = row_h.max(size.y);
        width = width.max(x);
    }
    let height = y + row_h + 20.0;
    let at = |pi: usize, q: Vec2| (offsets[pi].x + q.x * scale, offsets[pi].y - q.y * scale);
    let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' width='{width:.0}' height='{height:.0}' style='background:#fff'>\n");
    let panel_of = |v: u32| mp.panel_vertices.iter().position(|r| r.contains(&v)).unwrap();
    for t in &mp.mesh.tris {
        let pi = panel_of(t[0]);
        let p: Vec<String> = t.iter().map(|&v| at(pi, mp.uv[v as usize])).map(|(x, y)| format!("{x:.1},{y:.1}")).collect();
        svg += &format!("<polygon points='{}' fill='#f3d7cf' stroke='#a66' stroke-width='0.3'/>\n", p.join(" "));
    }
    let colors = ["#06c", "#0a6", "#c60", "#90c", "#c03", "#088", "#660", "#36f", "#f39", "#393"];
    for (si, s) in pat.seams.iter().enumerate() {
        let c = colors[si % colors.len()];
        for r in s.a.iter().chain(&s.b) {
            let pts: Vec<String> = mp.edge_vertices[r.panel][r.edge].iter().map(|&v| at(r.panel, mp.uv[v as usize])).map(|(x, y)| format!("{x:.1},{y:.1}")).collect();
            svg += &format!("<polyline points='{}' fill='none' stroke='{c}' stroke-width='3'/>\n", pts.join(" "));
        }
        for (side, chain) in [("a", &s.a), ("b", &s.b)] {
            let r = chain[0];
            let ev = &mp.edge_vertices[r.panel][r.edge];
            let v = if r.backward { *ev.last().unwrap() } else { ev[0] };
            let (x, y) = at(r.panel, mp.uv[v as usize]);
            svg += &format!("<text x='{x:.0}' y='{:.0}' font-size='11' fill='{c}'>{}.{side}▶</text>\n", y - 4.0, s.name);
        }
    }
    for (pi, panel) in pat.panels.iter().enumerate() {
        let (lo, hi) = bounds[pi];
        let (x, y) = at(pi, Vec2::new(lo.x, hi.y));
        svg += &format!("<text x='{x:.0}' y='{:.0}' font-size='14' font-weight='bold'>{}</text>\n", y - 14.0, panel.name);
        for (q, text) in labels.get(pi).into_iter().flatten() {
            let (x, y) = at(pi, *q);
            svg += &format!("<circle cx='{x:.1}' cy='{y:.1}' r='3' fill='#000'/><text x='{:.0}' y='{:.0}' font-size='12'>{text}</text>\n", x + 4.0, y + 12.0);
        }
    }
    svg += &format!("<text x='10' y='20' font-size='14'>{title}: {} vertices, {} triangles</text>\n</svg>\n", mp.mesh.n_verts(), mp.mesh.tris.len());
    svg
}
