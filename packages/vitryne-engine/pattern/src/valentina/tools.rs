// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs a pattern's drafting tools in file order, giving every point and curve its place.
//!
//! Each tool reads objects made before it (by id) and formulas over the measurements, the
//! increments and what earlier tools define:
//!   - `Line_A_B` and `AngleLine_A_B` for any two named points (worked out when asked, so
//!     names that contain `_` resolve by trying each split);
//!   - for each curve its length under its name (`Spl_A_B`, `SplPath_A_D`, `Arc_C_12`, or its
//!     alias), and `Angle1…`, `Angle2…`, `C1Length…`, `C2Length…`, `Radius…` of it.
//!
//! A tool that fails (an unknown tool, circles that don't meet, a formula with an unknown
//! name) makes its objects unavailable with the reason, and so does every tool that needs
//! them; the rest still runs. Pieces then say which of their objects are missing and why.
//!
//! Curves are kept as cubic Béziers (splines and spline paths are, arcs are split into 45°
//! cubics), with the arc's own geometry where tools need it.

use std::collections::HashMap;

use glam::DVec2;
use roxmltree::Node;

use super::{
    Unit, attr_f64, formula,
    geom::{self, Cubic, PX_PER_MM},
    xml::Pattern,
};

#[derive(Debug, Clone)]
pub struct Point {
    pub name: String,
    /// Scene pixels, y down.
    pub p: DVec2,
}

#[derive(Debug, Clone, Copy)]
pub struct Arc {
    pub center: DVec2,
    pub r: f64,
    pub f1: f64,
    pub f2: f64,
}

impl Arc {
    pub fn sweep(&self) -> f64 {
        geom::arc_sweep(self.f1, self.f2)
    }

    /// The direction `deg` (from the centre) falls on the arc.
    pub fn contains(&self, deg: f64) -> bool {
        let tol = (geom::ON_LINE / self.r.max(1e-9)).to_degrees();
        geom::angle_to(self.f1, deg) <= self.sweep() + tol || geom::angle_to(deg, self.f1) <= tol
    }
}

#[derive(Debug, Clone)]
pub struct Curve {
    pub name: String,
    pub segs: Vec<Cubic>,
    pub arc: Option<Arc>,
    /// Names of the end points, for the names of its pieces when it is cut.
    pub ends: (String, String),
}

impl Curve {
    pub fn length(&self) -> f64 {
        self.segs.iter().map(geom::cubic_length).sum()
    }

    pub fn first(&self) -> DVec2 {
        self.segs[0][0]
    }

    pub fn last(&self) -> DVec2 {
        self.segs[self.segs.len() - 1][3]
    }

    pub fn points(&self) -> Vec<DVec2> {
        let mut out = Vec::new();
        for s in &self.segs {
            geom::cubic_flatten(s, &mut out);
        }
        out
    }

    fn head(&self) -> &str {
        self.name.split('_').next().unwrap_or("")
    }

    /// Split at arc length `at` (pixels from the start, clamped).
    pub fn cut_at_length(&self, at: f64) -> (Vec<Cubic>, Vec<Cubic>, DVec2) {
        let mut left = Vec::new();
        let mut rest = at.max(0.0);
        for (i, s) in self.segs.iter().enumerate() {
            let l = geom::cubic_length(s);
            if rest <= l || i + 1 == self.segs.len() {
                let t = geom::cubic_t_at_length(s, rest);
                let (a, b) = geom::cubic_split(s, t);
                let p = a[3];
                left.push(a);
                let mut right = vec![b];
                right.extend_from_slice(&self.segs[i + 1..]);
                return (left, right, p);
            }
            left.push(*s);
            rest -= l;
        }
        unreachable!("a curve has at least one segment")
    }

    /// The arc length from the start to the point of the curve nearest `p`.
    pub fn length_to(&self, p: DVec2) -> f64 {
        if geom::same_point(p, self.first()) {
            return 0.0;
        }
        if geom::same_point(p, self.last()) {
            return self.length();
        }
        // The nearest sample, then the nearest parameter around it (ternary search).
        let n = 64;
        let mut best = (f64::MAX, 0, 0.0);
        for (i, s) in self.segs.iter().enumerate() {
            for k in 0..=n {
                let t = k as f64 / n as f64;
                let d = geom::cubic_at(s, t).distance(p);
                if d < best.0 {
                    best = (d, i, t);
                }
            }
        }
        let (_, i, t) = best;
        let s = &self.segs[i];
        let (mut lo, mut hi) = ((t - 1.0 / n as f64).max(0.0), (t + 1.0 / n as f64).min(1.0));
        for _ in 0..80 {
            let (a, b) = (lo + (hi - lo) / 3.0, hi - (hi - lo) / 3.0);
            if geom::cubic_at(s, a).distance(p) < geom::cubic_at(s, b).distance(p) {
                hi = b;
            } else {
                lo = a;
            }
        }
        let before: f64 = self.segs[..i].iter().map(geom::cubic_length).sum();
        before + geom::cubic_length_to(s, (lo + hi) / 2.0)
    }

    fn transformed(&self, f: &dyn Fn(DVec2) -> DVec2) -> Curve {
        Curve {
            name: self.name.clone(),
            segs: self
                .segs
                .iter()
                .map(|s| [f(s[0]), f(s[1]), f(s[2]), f(s[3])])
                .collect(),
            arc: None,
            ends: self.ends.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum Object {
    Point(Point),
    Curve(Curve),
}

/// Every object of a pattern, where the tools put it.
pub struct Draft {
    pub unit: Unit,
    /// Measurements, increments and curve values, in the pattern's unit and degrees.
    values: HashMap<String, f64>,
    pub objects: HashMap<u32, Object>,
    /// Objects that couldn't be made, and why.
    pub unavailable: HashMap<u32, String>,
    point_names: HashMap<String, u32>,
    /// Lines the tools registered, `A_B` → the two points' ids (later ones replace earlier,
    /// which is how a name repeated in another block resolves).
    lines: HashMap<String, (u32, u32)>,
    /// Files before 1.2: ids in use, for the ids cut halves had implicitly.
    free_ids: Option<std::collections::HashSet<u32>>,
    /// Files before 0.3, where every cut curve's halves are objects at `id+1` and `id+2`.
    old_cuts: bool,
}

/// How a failure caused by another one starts.
const NEEDS: &str = "needs an object that failed";

fn id_attr(el: Node, name: &str) -> Result<u32, String> {
    let v = el
        .attribute(name)
        .ok_or_else(|| format!("no {name}"))?
        .trim();
    v.parse()
        .map_err(|_| format!("{name}=\"{v}\" is not an id"))
}

/// The ids an element makes, so its failure marks them all.
fn made_ids(el: Node) -> Vec<u32> {
    let mut out = Vec::new();
    let mut add = |name: &str| {
        if let Some(v) = el
            .attribute(name)
            .and_then(|v| v.trim().parse::<u32>().ok())
            && v != 0
        {
            out.push(v);
        }
    };
    for a in ["id", "segment1Id", "segment2Id", "segment3Id", "segment4Id"] {
        add(a);
    }
    if el.attribute("type") == Some("trueDarts") {
        add("point1");
        add("point2");
    }
    for d in el.children().filter(|c| c.has_tag_name("destination")) {
        for it in d.children().filter(|c| c.has_tag_name("item")) {
            if let Some(v) = it.attribute("idObject").and_then(|v| v.parse::<u32>().ok()) {
                out.push(v);
            }
        }
    }
    out
}

impl Draft {
    /// Runs every tool of `pattern`, with `values` holding the measurements (pattern unit).
    pub fn run(pattern: &Pattern, measurements: HashMap<String, f64>) -> Self {
        let mut d = Draft {
            unit: pattern.unit,
            values: measurements,
            objects: HashMap::new(),
            unavailable: HashMap::new(),
            point_names: HashMap::new(),
            lines: HashMap::new(),
            free_ids: None,
            old_cuts: pattern.version < (0, 3, 0),
        };
        let elements: Vec<Node> = pattern
            .blocks
            .iter()
            .flat_map(|b| b.descendants())
            .filter(|n| n.is_element())
            .collect();
        if pattern.version < (1, 2, 0) {
            let mut used = std::collections::HashSet::new();
            // Ids elements and operation copies take (not ids they refer to).
            for el in &elements {
                let attr = if el.has_tag_name("item")
                    && el.parent().is_some_and(|p| p.has_tag_name("destination"))
                {
                    "idObject"
                } else {
                    "id"
                };
                if let Some(v) = el.attribute(attr).and_then(|v| v.parse::<u32>().ok()) {
                    used.insert(v);
                }
            }
            d.free_ids = Some(used);
        }
        for (name, f) in &pattern.increments {
            // An increment that can't be computed stays unknown; formulas using it say so.
            if let Ok(v) = formula::eval(f, &|n: &str| d.value(n)) {
                d.values.insert(name.clone(), v);
            }
        }
        for block in &pattern.blocks {
            for section in ["calculation", "modeling"] {
                if let Some(s) = super::child(*block, section) {
                    for el in s.children().filter(|c| c.is_element()) {
                        if let Err(e) = d.tool(el) {
                            let what = match el.attribute("name") {
                                Some(n) if !e.starts_with(NEEDS) => format!("{n}: "),
                                _ => String::new(),
                            };
                            for id in made_ids(el) {
                                d.unavailable
                                    .entry(id)
                                    .or_insert_with(|| format!("{what}{e}"));
                            }
                        }
                    }
                }
            }
        }
        d
    }

    fn to_px(&self, v: f64) -> f64 {
        v * self.unit.mm() * PX_PER_MM
    }

    pub fn from_px(&self, v: f64) -> f64 {
        v / PX_PER_MM / self.unit.mm()
    }

    /// Two named points from `A_B`: a registered line's, else any two points so named (names
    /// may hold `_`, so each split is tried).
    fn two_points(&self, rest: &str) -> Option<(DVec2, DVec2)> {
        if let Some((a, b)) = self.lines.get(rest)
            && let (Ok(a), Ok(b)) = (self.point(*a), self.point(*b))
        {
            return Some((a.p, b.p));
        }
        for (i, _) in rest.match_indices('_') {
            let (a, b) = (&rest[..i], &rest[i + 1..]);
            if let (Some(a), Some(b)) = (self.point_names.get(a), self.point_names.get(b))
                && let (Some(Object::Point(a)), Some(Object::Point(b))) =
                    (self.objects.get(a), self.objects.get(b))
            {
                return Some((a.p, b.p));
            }
        }
        None
    }

    pub fn value(&self, name: &str) -> Option<f64> {
        if let Some(v) = self.values.get(name) {
            return Some(*v);
        }
        if let Some(rest) = name.strip_prefix("AngleLine_") {
            return self.two_points(rest).map(|(a, b)| geom::angle(a, b));
        }
        if let Some(rest) = name.strip_prefix("Line_") {
            return self
                .two_points(rest)
                .map(|(a, b)| self.from_px(a.distance(b)));
        }
        None
    }

    fn f(&self, el: Node, attr: &str, default: &str) -> Result<f64, String> {
        formula::eval(el.attribute(attr).unwrap_or(default), &|n: &str| {
            self.value(n)
        })
    }

    fn len(&self, el: Node, attr: &str, default: &str) -> Result<f64, String> {
        Ok(self.to_px(self.f(el, attr, default)?))
    }

    /// Evaluates with `CurrentLength` set to `px` (the line or curve the tool works on).
    fn with_current<T>(&mut self, px: f64, f: impl FnOnce(&Self) -> T) -> T {
        let v = self.from_px(px);
        self.values.insert("CurrentLength".into(), v);
        let out = f(self);
        self.values.remove("CurrentLength");
        out
    }

    fn object(&self, id: u32) -> Result<&Object, String> {
        if let Some(o) = self.objects.get(&id) {
            return Ok(o);
        }
        Err(match self.unavailable.get(&id) {
            // The first failure is the one to fix.
            Some(why) if why.starts_with(NEEDS) => why.clone(),
            Some(why) => format!("{NEEDS} ({why})"),
            None => format!("needs object {id}, which the file doesn't make"),
        })
    }

    pub fn point(&self, id: u32) -> Result<&Point, String> {
        match self.object(id)? {
            Object::Point(p) => Ok(p),
            Object::Curve(c) => Err(format!("{} is a curve, not a point", c.name)),
        }
    }

    pub fn curve(&self, id: u32) -> Result<&Curve, String> {
        match self.object(id)? {
            Object::Curve(c) => Ok(c),
            Object::Point(p) => Err(format!("{} is a point, not a curve", p.name)),
        }
    }

    fn p(&self, el: Node, attr: &str) -> Result<DVec2, String> {
        Ok(self.point(id_attr(el, attr)?)?.p)
    }

    fn curve_id(&self, el: Node, attr: &str) -> Result<u32, String> {
        id_attr(el, attr)
    }

    fn c(&self, el: Node, attr: &str) -> Result<&Curve, String> {
        self.curve(self.curve_id(el, attr)?)
    }

    fn add_point(&mut self, id: u32, name: &str, p: DVec2) {
        if !p.is_finite() {
            self.unavailable.insert(
                id,
                format!("{name}: no position (a formula or a tool gave none)"),
            );
            return;
        }
        self.point_names.insert(name.to_string(), id);
        self.objects.insert(
            id,
            Object::Point(Point {
                name: name.to_string(),
                p,
            }),
        );
    }

    /// Adds a curve and the values it defines (also under `alias`, if any).
    fn add_curve(&mut self, id: u32, c: Curve, alias: Option<&str>) {
        let head = c.head().to_string();
        let mut names = vec![c.name.clone()];
        if let Some(a) = alias.filter(|a| !a.is_empty()) {
            names.push(format!("{head}_{a}"));
        }
        let (s0, s1) = (c.segs[0], c.segs[c.segs.len() - 1]);
        let len = self.from_px(c.length());
        for n in &names {
            // A path's pieces: `SplPath_A_D_Seg_1`, ...
            if head == "SplPath" {
                for (i, s) in c.segs.iter().enumerate() {
                    let seg = format!("{n}_Seg_{}", i + 1);
                    self.values
                        .insert(seg.clone(), self.from_px(geom::cubic_length(s)));
                    self.values
                        .insert(format!("Angle1{seg}"), geom::angle(s[0], s[1]));
                    self.values
                        .insert(format!("Angle2{seg}"), geom::angle(s[3], s[2]));
                    self.values
                        .insert(format!("C1Length{seg}"), self.from_px(s[0].distance(s[1])));
                    self.values
                        .insert(format!("C2Length{seg}"), self.from_px(s[3].distance(s[2])));
                }
            }
        }
        for n in names {
            self.values.insert(n.clone(), len);
            match &c.arc {
                Some(a) => {
                    self.values.insert(format!("Radius{n}"), self.from_px(a.r));
                    self.values.insert(format!("Angle1{n}"), a.f1);
                    self.values.insert(format!("Angle2{n}"), a.f2);
                }
                None => {
                    self.values
                        .insert(format!("Angle1{n}"), geom::angle(s0[0], s0[1]));
                    self.values
                        .insert(format!("Angle2{n}"), geom::angle(s1[3], s1[2]));
                    self.values
                        .insert(format!("C1Length{n}"), self.from_px(s0[0].distance(s0[1])));
                    self.values
                        .insert(format!("C2Length{n}"), self.from_px(s1[3].distance(s1[2])));
                }
            }
        }
        self.objects.insert(id, Object::Curve(c));
    }

    /// The two pieces of curve `curve_id` either side of `p` (on the curve), as cut and
    /// intersection tools make them, under their ids and names if the file gives them.
    fn add_segments(
        &mut self,
        el: Node,
        curve_id: u32,
        p: DVec2,
        p_name: &str,
        attrs: [&str; 4],
    ) -> Result<(), String> {
        let c = self.curve(curve_id)?.clone();
        let at = c.length_to(p);
        self.add_cut(el, &c, at, p_name, attrs);
        Ok(())
    }

    fn add_cut(&mut self, el: Node, c: &Curve, at: f64, p_name: &str, attrs: [&str; 4]) {
        let (left, right, _) = c.cut_at_length(at);
        let head = c.head().to_string();
        let arcs = c.arc.map(|a| {
            let f = a.f1 + (at / a.r).to_degrees();
            (Arc { f2: f, ..a }, Arc { f1: f, ..a })
        });
        let [id1, id2, name1, name2] = attrs;
        // Before 1.2 an arc's halves took the ids after the tool's (the later ones: +3, +4 for
        // a second curve), unless something else uses them; before 0.3 every curve's did.
        let base = id_attr(el, "id").unwrap_or(0) + if id1 == "segment3Id" { 2 } else { 0 };
        let implicit = |k: u32| -> Option<u32> {
            let used = self.free_ids.as_ref()?;
            ((c.arc.is_some() || self.old_cuts) && !used.contains(&(base + k))).then_some(base + k)
        };
        let ids = [
            el.attribute(id1)
                .and_then(|v| v.parse::<u32>().ok())
                .filter(|v| *v != 0)
                .or_else(|| implicit(1)),
            el.attribute(id2)
                .and_then(|v| v.parse::<u32>().ok())
                .filter(|v| *v != 0)
                .or_else(|| implicit(2)),
        ];
        let parts = [
            (
                left,
                (c.ends.0.clone(), p_name.to_string()),
                ids[0],
                name1,
                arcs.map(|a| a.0),
            ),
            (
                right,
                (p_name.to_string(), c.ends.1.clone()),
                ids[1],
                name2,
                arcs.map(|a| a.1),
            ),
        ];
        for (segs, ends, id, name_a, arc) in parts {
            let name = el
                .attribute(name_a)
                .filter(|n| !n.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{head}_{}_{}", ends.0, ends.1));
            let curve = Curve {
                name,
                segs,
                arc,
                ends,
            };
            match id {
                Some(id) => self.add_curve(id, curve, None),
                // Not an object of its own (files before 1.2): only its values.
                None => {
                    let len = self.from_px(curve.length());
                    self.values.insert(curve.name, len);
                }
            }
        }
    }

    fn tool(&mut self, el: Node) -> Result<(), String> {
        let tag = el.tag_name().name();
        let ty = el.attribute("type").unwrap_or("");
        match tag {
            "point" => {
                self.point_tool(el, ty)?;
                self.register_lines(el);
                Ok(())
            }
            "spline" => self.spline_tool(el, ty),
            "arc" => self.arc_tool(el, ty),
            "operation" => self.operation(el, ty),
            // Drawn lines carry nothing; internal paths are read with the pieces.
            "line" => {
                if let (Ok(a), Ok(b)) = (id_attr(el, "firstPoint"), id_attr(el, "secondPoint")) {
                    self.register(a, b);
                }
                Ok(())
            }
            "path" => Ok(()),
            "elArc" if ty == "modeling" => self.copy(el),
            "elArc" => Err("elliptical arcs are not supported yet".into()),
            "tools" => Err(format!("the \"{ty}\" tool is not supported")),
            other => Err(format!("<{other}> is not supported")),
        }
    }

    fn register(&mut self, a: u32, b: u32) {
        if let (Ok(pa), Ok(pb)) = (self.point(a), self.point(b)) {
            let key = format!("{}_{}", pa.name, pb.name);
            self.lines.insert(key, (a, b));
        }
    }

    /// The lines a point tool draws: from each point it starts from to the new point.
    fn register_lines(&mut self, el: Node) {
        const FROM: [&str; 11] = [
            "basePoint",
            "firstPoint",
            "secondPoint",
            "thirdPoint",
            "p1Line",
            "p2Line",
            "pShoulder",
            "center",
            "tangent",
            "cCenter",
            "axisP1",
        ];
        let Ok(id) = id_attr(el, "id") else {
            return;
        };
        if !matches!(self.objects.get(&id), Some(Object::Point(_))) {
            return;
        }
        for a in FROM {
            if let Ok(from) = id_attr(el, a)
                && from != id
            {
                self.register(from, id);
            }
        }
    }

    fn copy(&mut self, el: Node) -> Result<(), String> {
        let id = id_attr(el, "id")?;
        let src = id_attr(el, "idObject")?;
        match self.object(src)?.clone() {
            Object::Point(p) => {
                self.objects.insert(id, Object::Point(p));
            }
            Object::Curve(c) => {
                self.objects.insert(id, Object::Curve(c));
            }
        }
        Ok(())
    }

    fn point_tool(&mut self, el: Node, ty: &str) -> Result<(), String> {
        let id = id_attr(el, "id")?;
        let name = el.attribute("name").unwrap_or("A").to_string();
        let p = match ty {
            "single" => DVec2::new(
                self.to_px(attr_f64(el, "x", 0.0)?),
                self.to_px(attr_f64(el, "y", 0.0)?),
            ),
            "endLine" => geom::polar(
                self.p(el, "basePoint")?,
                self.f(el, "angle", "0")?,
                self.len(el, "length", "100")?,
            ),
            "alongLine" => {
                let (a, b) = (self.p(el, "firstPoint")?, self.p(el, "secondPoint")?);
                let len = self.with_current(a.distance(b), |d| d.len(el, "length", "100"))?;
                geom::polar(a, geom::angle(a, b), len)
            }
            "shoulder" => shoulder(
                self.p(el, "p1Line")?,
                self.p(el, "p2Line")?,
                self.p(el, "pShoulder")?,
                self.len(el, "length", "100")?,
            ),
            "normal" => {
                let (a, b) = (self.p(el, "firstPoint")?, self.p(el, "secondPoint")?);
                geom::polar(
                    a,
                    geom::angle(a, b) + 90.0 + attr_f64(el, "angle", 0.0)?,
                    self.len(el, "length", "100")?,
                )
            }
            "bisector" => {
                let (a, b, c) = (
                    self.p(el, "firstPoint")?,
                    self.p(el, "secondPoint")?,
                    self.p(el, "thirdPoint")?,
                );
                let (a1, a2) = (geom::angle(b, a), geom::angle(b, c));
                let between = geom::angle_to(a1, a2);
                let dir = if between > 180.0 {
                    a1 - (360.0 - between) / 2.0
                } else {
                    a1 + between / 2.0
                };
                geom::polar(b, dir, self.len(el, "length", "100")?)
            }
            "lineIntersect" => geom::line_intersection(
                self.p(el, "p1Line1")?,
                self.p(el, "p2Line1")?,
                self.p(el, "p1Line2")?,
                self.p(el, "p2Line2")?,
            )
            .ok_or("the lines are parallel")?,
            "pointOfContact" => {
                let r = self.len(el, "radius", "0")?.abs();
                let (c, a, b) = (
                    self.p(el, "center")?,
                    self.p(el, "firstPoint")?,
                    self.p(el, "secondPoint")?,
                );
                match geom::line_circle(c, r, a, b).as_slice() {
                    [] => return Err("the circle doesn't meet the line".into()),
                    [p] => *p,
                    [p1, p2, ..] => {
                        let (f1, f2) = (geom::on_segment(*p1, a, b), geom::on_segment(*p2, a, b));
                        if f1 == f2 {
                            if a.distance(*p1) <= a.distance(*p2) {
                                *p1
                            } else {
                                *p2
                            }
                        } else if f1 {
                            *p1
                        } else {
                            *p2
                        }
                    }
                }
            }
            "height" => geom::closest_on_line(
                self.p(el, "p1Line")?,
                self.p(el, "p2Line")?,
                self.p(el, "basePoint")?,
            ),
            "triangle" => triangle(
                self.p(el, "axisP1")?,
                self.p(el, "axisP2")?,
                self.p(el, "firstPoint")?,
                self.p(el, "secondPoint")?,
            )?,
            "pointOfIntersection" => {
                let (a, b) = (self.p(el, "firstPoint")?, self.p(el, "secondPoint")?);
                DVec2::new(a.x, b.y)
            }
            "cutSpline" | "cutSplinePath" | "cutArc" => {
                let attr = match ty {
                    "cutSpline" => "spline",
                    "cutSplinePath" => "splinePath",
                    _ => "arc",
                };
                let c = self.c(el, attr)?.clone();
                let total = c.length();
                let mut at = self.with_current(total, |d| d.len(el, "length", "0"))?;
                if at < 0.0 {
                    at += total;
                }
                let at = at.clamp(0.0, total);
                let (_, _, p) = c.cut_at_length(at);
                self.add_point(id, &name, p);
                self.add_cut(
                    el,
                    &c,
                    at,
                    &name,
                    ["segment1Id", "segment2Id", "curveName1", "curveName2"],
                );
                return Ok(());
            }
            "lineIntersectAxis" => {
                let base = self.p(el, "basePoint")?;
                let axis = geom::polar(base, self.f(el, "angle", "0")?, 100.0);
                geom::line_intersection(base, axis, self.p(el, "p1Line")?, self.p(el, "p2Line")?)
                    .ok_or("the axis is parallel to the line")?
            }
            "curveIntersectAxis" => {
                let base = self.p(el, "basePoint")?;
                let curve_id = self.curve_id(el, "curve")?;
                let pts = self.curve(curve_id)?.points();
                let p = curve_axis(base, self.f(el, "angle", "0")?, &pts)
                    .ok_or("the axis doesn't meet the curve")?;
                self.add_point(id, &name, p);
                self.add_segments(
                    el,
                    curve_id,
                    p,
                    &name,
                    ["segment1Id", "segment2Id", "name1", "name2"],
                )?;
                return Ok(());
            }
            "pointOfIntersectionArcs" => {
                let (a1, a2) = (
                    self.c(el, "firstArc")?
                        .arc
                        .ok_or("firstArc is not an arc")?,
                    self.c(el, "secondArc")?
                        .arc
                        .ok_or("secondArc is not an arc")?,
                );
                let ps = geom::circle_circle(a1.center, a1.r, a2.center, a2.r)
                    .ok_or("the arcs are the same")?;
                let on = |p: &DVec2| {
                    a1.contains(geom::angle(a1.center, *p))
                        && a2.contains(geom::angle(a2.center, *p))
                };
                pick_on(&ps, on, cross(el)?).ok_or("the arcs don't meet")?
            }
            "pointOfIntersectionCircles" => {
                let ps = geom::circle_circle(
                    self.p(el, "c1Center")?,
                    self.len(el, "c1Radius", "0")?.abs(),
                    self.p(el, "c2Center")?,
                    self.len(el, "c2Radius", "0")?.abs(),
                )
                .ok_or("the circles are the same")?;
                pick(&ps, cross(el)?).ok_or("the circles don't meet")?
            }
            "pointFromCircleAndTangent" => {
                let ps = geom::tangent_points(
                    self.p(el, "tangent")?,
                    self.p(el, "cCenter")?,
                    self.len(el, "cRadius", "0")?.abs(),
                );
                pick(&ps, cross(el)?).ok_or("the point is inside the circle")?
            }
            "pointFromArcAndTangent" => {
                let a = self.c(el, "arc")?.arc.ok_or("arc is not an arc")?;
                let ps = geom::tangent_points(self.p(el, "tangent")?, a.center, a.r);
                pick_on(&ps, |p| a.contains(geom::angle(a.center, *p)), cross(el)?)
                    .ok_or("no tangent touches the arc")?
            }
            "pointOfIntersectionCurves" => {
                let (id1, id2) = (self.curve_id(el, "curve1")?, self.curve_id(el, "curve2")?);
                let p = curves_cross(
                    &self.curve(id1)?.points(),
                    &self.curve(id2)?.points(),
                    attr_f64(el, "vCrossPoint", 1.0)? as i32,
                    attr_f64(el, "hCrossPoint", 1.0)? as i32,
                )
                .ok_or("the curves don't meet")?;
                self.add_point(id, &name, p);
                self.add_segments(
                    el,
                    id1,
                    p,
                    &name,
                    ["segment1Id", "segment2Id", "curve1Name1", "curve1Name2"],
                )?;
                self.add_segments(
                    el,
                    id2,
                    p,
                    &name,
                    ["segment3Id", "segment4Id", "curve2Name1", "curve2Name2"],
                )?;
                return Ok(());
            }
            "trueDarts" => {
                let (p1, p2) = true_darts(
                    self.p(el, "baseLineP1")?,
                    self.p(el, "baseLineP2")?,
                    self.p(el, "dartP1")?,
                    self.p(el, "dartP2")?,
                    self.p(el, "dartP3")?,
                )?;
                let n1 = el.attribute("name1").unwrap_or("A").to_string();
                let n2 = el.attribute("name2").unwrap_or("A").to_string();
                self.add_point(id_attr(el, "point1")?, &n1, p1);
                self.add_point(id_attr(el, "point2")?, &n2, p2);
                return Ok(());
            }
            "modeling" => return self.copy(el),
            // Marks inside a piece; not part of its outline.
            "pin" | "placeLabel" => return Ok(()),
            other => return Err(format!("the \"{other}\" point tool is not supported")),
        };
        self.add_point(id, &name, p);
        Ok(())
    }

    fn spline_tool(&mut self, el: Node, ty: &str) -> Result<(), String> {
        let id = id_attr(el, "id")?;
        let dup = match attr_f64(el, "duplicate", 0.0)? as u32 {
            0 => String::new(),
            n => format!("_{n}"),
        };
        let alias = el.attribute("alias");
        let has = |a: &str| el.attribute(a).is_some();
        let path_points: Vec<Node> = el
            .children()
            .filter(|c| c.has_tag_name("pathPoint"))
            .collect();
        let (segs, first, last, head) = match ty {
            "simple" | "simpleInteractive" => {
                let (a, b) = (
                    self.point(id_attr(el, "point1")?)?.clone(),
                    self.point(id_attr(el, "point4")?)?.clone(),
                );
                let old = !has("length1")
                    && !has("length2")
                    && (has("kAsm1") || has("kAsm2") || has("kCurve"));
                let seg = if old {
                    old_spline(
                        a.p,
                        b.p,
                        attr_f64(el, "angle1", 270.0)?,
                        attr_f64(el, "angle2", 90.0)?,
                        attr_f64(el, "kAsm1", 1.0)?,
                        attr_f64(el, "kAsm2", 1.0)?,
                        attr_f64(el, "kCurve", 1.0)?,
                    )
                } else {
                    [
                        a.p,
                        geom::polar(
                            a.p,
                            self.f(el, "angle1", "0")?,
                            self.len(el, "length1", "0")?,
                        ),
                        geom::polar(
                            b.p,
                            self.f(el, "angle2", "0")?,
                            self.len(el, "length2", "0")?,
                        ),
                        b.p,
                    ]
                };
                (vec![seg], a.name, b.name, "Spl")
            }
            "cubicBezier" => {
                let ps = ["point1", "point2", "point3", "point4"]
                    .map(|a| id_attr(el, a).and_then(|i| self.point(i).cloned()));
                let [a, b, c, d] = ps;
                let (a, b, c, d) = (a?, b?, c?, d?);
                (vec![[a.p, b.p, c.p, d.p]], a.name, d.name, "Spl")
            }
            "path" | "pathInteractive" => {
                let old = has("kCurve")
                    || path_points.first().is_some_and(|p| {
                        p.attribute("kAsm1").is_some() && p.attribute("length1").is_none()
                    });
                let mut pts = Vec::new();
                for pp in &path_points {
                    pts.push((self.point(id_attr(*pp, "pSpline")?)?.clone(), *pp));
                }
                if pts.len() < 2 {
                    return Err("a spline path needs two points".into());
                }
                let k_curve = attr_f64(el, "kCurve", 1.0)?;
                let mut segs = Vec::new();
                for w in pts.windows(2) {
                    let ((a, ea), (b, eb)) = (&w[0], &w[1]);
                    segs.push(if old {
                        old_spline(
                            a.p,
                            b.p,
                            attr_f64(*ea, "angle", 0.0)?,
                            attr_f64(*eb, "angle", 0.0)? + 180.0,
                            attr_f64(*ea, "kAsm2", 1.0)?,
                            attr_f64(*eb, "kAsm1", 1.0)?,
                            k_curve,
                        )
                    } else {
                        [
                            a.p,
                            geom::polar(
                                a.p,
                                self.f(*ea, "angle2", "0")?,
                                self.len(*ea, "length2", "0")?,
                            ),
                            geom::polar(
                                b.p,
                                self.f(*eb, "angle1", "0")?,
                                self.len(*eb, "length1", "0")?,
                            ),
                            b.p,
                        ]
                    });
                }
                let (first, last) = (pts[0].0.name.clone(), pts[pts.len() - 1].0.name.clone());
                (segs, first, last, "SplPath")
            }
            "cubicBezierPath" => {
                let mut pts = Vec::new();
                for pp in &path_points {
                    pts.push(self.point(id_attr(*pp, "pSpline")?)?.clone());
                }
                if pts.len() < 4 || (pts.len() - 1) % 3 != 0 {
                    return Err(format!("a Bézier path can't have {} points", pts.len()));
                }
                let segs = (0..(pts.len() - 1) / 3)
                    .map(|k| {
                        [
                            pts[3 * k].p,
                            pts[3 * k + 1].p,
                            pts[3 * k + 2].p,
                            pts[3 * k + 3].p,
                        ]
                    })
                    .collect();
                (
                    segs,
                    pts[0].name.clone(),
                    pts[pts.len() - 1].name.clone(),
                    "SplPath",
                )
            }
            "modelingSpline" | "modelingPath" => return self.copy(el),
            other => return Err(format!("the \"{other}\" curve tool is not supported")),
        };
        let name = format!("{head}_{first}_{last}{dup}");
        self.add_curve(
            id,
            Curve {
                name,
                segs,
                arc: None,
                ends: (first, last),
            },
            alias,
        );
        Ok(())
    }

    fn arc_tool(&mut self, el: Node, ty: &str) -> Result<(), String> {
        let id = id_attr(el, "id")?;
        let (center, f1) = match ty {
            "simple" | "arcWithLength" => (
                self.point(id_attr(el, "center")?)?.clone(),
                self.f(el, "angle1", "180")?,
            ),
            "modeling" => return self.copy(el),
            other => return Err(format!("the \"{other}\" arc tool is not supported")),
        };
        let r = self.len(el, "radius", "10")?;
        if r == 0.0 {
            return Err("the radius is zero".into());
        }
        let f2 = if ty == "simple" {
            self.f(el, "angle2", "270")?
        } else {
            f1 + (self.len(el, "length", "10")? / r).to_degrees()
        };
        let arc = Arc {
            center: center.p,
            r: r.abs(),
            f1,
            f2,
        };
        let mut segs = geom::arc_cubics(arc.center, arc.r, f1, f2);
        if r < 0.0 {
            // A negative radius runs the arc the other way.
            segs = segs.iter().rev().map(geom::cubic_reverse).collect();
        }
        let ends = (center.name.clone(), center.name.clone());
        self.add_curve(
            id,
            Curve {
                name: format!("Arc_{}_{id}", center.name),
                segs,
                arc: (r > 0.0).then_some(arc),
                ends,
            },
            el.attribute("alias"),
        );
        Ok(())
    }

    fn operation(&mut self, el: Node, ty: &str) -> Result<(), String> {
        let items = |tag: &str| -> Vec<Node> {
            el.children()
                .filter(|c| c.has_tag_name(tag))
                .flat_map(|s| s.children().filter(|c| c.has_tag_name("item")))
                .collect()
        };
        let (src, dst) = (items("source"), items("destination"));
        if src.len() != dst.len() {
            return Err("its source and destination differ in size".into());
        }
        let suffix = el.attribute("suffix").unwrap_or("");
        let sources: Vec<Object> = src
            .iter()
            .map(|s| id_attr(*s, "idObject").and_then(|i| self.object(i).cloned()))
            .collect::<Result<_, _>>()?;
        let f: Box<dyn Fn(DVec2) -> DVec2> = match ty {
            "rotation" => {
                let (o, deg) = (self.p(el, "center")?, self.f(el, "angle", "10")?);
                Box::new(move |p| geom::rotate(o, p, deg))
            }
            "flippingByLine" => {
                let (a, b) = (self.p(el, "p1Line")?, self.p(el, "p2Line")?);
                Box::new(move |p| geom::mirror(a, b, p))
            }
            "flippingByAxis" => {
                let o = self.p(el, "center")?;
                let b = if attr_f64(el, "axisType", 1.0)? as i32 == 1 {
                    o + DVec2::new(0.0, 100.0)
                } else {
                    o + DVec2::new(100.0, 0.0)
                };
                Box::new(move |p| geom::mirror(o, b, p))
            }
            "moving" => {
                let (deg, len, turn) = (
                    self.f(el, "angle", "0")?,
                    self.len(el, "length", "0")?,
                    self.f(el, "rotationAngle", "0")?,
                );
                let origin = match el.attribute("center").and_then(|v| v.parse::<u32>().ok()) {
                    Some(c) if c != 0 => self.point(c)?.p,
                    // The middle of what moves, moved.
                    _ => {
                        let mut lo = DVec2::splat(f64::MAX);
                        let mut hi = DVec2::splat(f64::MIN);
                        for o in &sources {
                            let pts = match o {
                                Object::Point(p) => vec![p.p],
                                Object::Curve(c) => c.points(),
                            };
                            for p in pts {
                                lo = lo.min(p);
                                hi = hi.max(p);
                            }
                        }
                        geom::polar((lo + hi) / 2.0, deg, len)
                    }
                };
                Box::new(move |p| geom::rotate(origin, geom::polar(p, deg, len), turn))
            }
            other => return Err(format!("the \"{other}\" operation is not supported")),
        };
        for ((s, d), obj) in src.iter().zip(&dst).zip(sources) {
            let id = id_attr(*d, "idObject")?;
            let given = s.attribute("name").filter(|n| !n.is_empty());
            match obj {
                Object::Point(p) => {
                    let name = given
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{}{suffix}", p.name));
                    self.add_point(id, &name, f(p.p));
                }
                Object::Curve(c) => {
                    let mut moved = c.transformed(&*f);
                    moved.name = given
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{}{suffix}", c.name));
                    if ty == "rotation"
                        && let Some(a) = c.arc
                    {
                        let turn = geom::angle(f(a.center), f(geom::polar(a.center, 0.0, 1.0)));
                        moved.arc = Some(Arc {
                            center: f(a.center),
                            f1: a.f1 + turn,
                            f2: a.f2 + turn,
                            ..a
                        });
                    }
                    self.add_curve(id, moved, s.attribute("alias"));
                }
            }
        }
        Ok(())
    }
}

/// A spline from end points, angles and the old length coefficients.
fn old_spline(p1: DVec2, p4: DVec2, a1: f64, a2: f64, k1: f64, k2: f64, k_curve: f64) -> Cubic {
    let d = if geom::same_point(p1, p4) {
        geom::ON_LINE * 2.0
    } else {
        p1.distance(p4)
    };
    let l = k_curve * d / std::f64::consts::SQRT_2 * 4.0 / 3.0
        * (90.0f64 * 45.0 / 180.0).to_radians().tan();
    [
        p1,
        geom::polar(p1, a1, l * k1),
        geom::polar(p4, a2, l * k2),
        p4,
    ]
}

/// The point on line `a b` beyond `b` at distance `len` from `shoulder` (the shoulder tool);
/// `b` itself when there is none.
fn shoulder(a: DVec2, b: DVec2, shoulder: DVec2, len: f64) -> DVec2 {
    if len <= 0.0 {
        return b;
    }
    let base = a.distance(b);
    let dir = geom::angle(a, b).round();
    let ps = geom::line_circle(shoulder, len, a, b);
    for p in ps {
        if a.distance(p) > base && geom::angle(a, p).round() == dir {
            return p;
        }
    }
    b
}

/// The point on the axis where the triangle with `p1 p2` gets its right angle, searched in
/// one-pixel steps from the hypotenuse as the apps do.
fn triangle(axis1: DVec2, axis2: DVec2, p1: DVec2, p2: DVec2) -> Result<DVec2, String> {
    let start = geom::line_intersection(axis1, axis2, p1, p2).ok_or("the axis is parallel")?;
    let dir = geom::angle(axis1, axis2);
    let c = p1.distance(p2).floor() as i64;
    let mut len = 1.0;
    for _ in 0..10_000_000 {
        len += 1.0;
        let p = geom::polar(start, dir, len);
        let a = p.distance(p1).floor() as i64;
        let b = p.distance(p2).floor() as i64;
        if c * c <= a * a + b * b {
            return Ok(p);
        }
    }
    Err("no right angle on the axis".into())
}

fn true_darts(
    base1: DVec2,
    base2: DVec2,
    d1: DVec2,
    d2: DVec2,
    d3: DVec2,
) -> Result<(DVec2, DVec2), String> {
    let deg = geom::angle_to(geom::angle(d2, d3), geom::angle(d2, d1));
    let turned = geom::rotate(d2, base2, deg);
    let p1 = geom::line_intersection(base1, turned, d2, d1).ok_or("the dart lines are parallel")?;
    let p2 = geom::rotate(d2, p1, -deg);
    Ok((p1, p2))
}

/// `crossPoint`: 1 the first of two, 2 the second.
fn cross(el: Node) -> Result<i32, String> {
    Ok(attr_f64(el, "crossPoint", 1.0)? as i32)
}

fn pick(ps: &[DVec2], which: i32) -> Option<DVec2> {
    match ps {
        [] => None,
        [p] => Some(*p),
        [a, b, ..] => Some(if which == 2 { *b } else { *a }),
    }
}

/// Of two candidates, those `on` its arcs; the chosen one if both are.
fn pick_on(ps: &[DVec2], on: impl Fn(&DVec2) -> bool, which: i32) -> Option<DVec2> {
    let ok: Vec<DVec2> = ps.iter().copied().filter(|p| on(p)).collect();
    match (ps.len(), ok.len()) {
        (2, 2) => pick(ps, which),
        (_, 0) => None,
        _ => Some(ok[0]),
    }
}

fn polyline_line(points: &[DVec2], a: DVec2, b: DVec2) -> Vec<DVec2> {
    points
        .windows(2)
        .filter_map(|w| geom::segment_intersection(a, b, w[0], w[1]))
        .collect()
}

/// Where the axis through `p` at `deg` meets the curve: the nearest crossing ahead, else the
/// nearest behind (the curve-and-axis tool).
fn curve_axis(p: DVec2, deg: f64, curve: &[DVec2]) -> Option<DVec2> {
    let far = 1e7;
    let mut hits = polyline_line(curve, p, geom::polar(p, deg, far));
    hits.extend(polyline_line(curve, p, geom::polar(p, deg + 180.0, far)));
    let on_curve = || curve.windows(2).any(|w| geom::on_segment(p, w[0], w[1]));
    if hits.is_empty() {
        return on_curve().then_some(p);
    }
    if hits.len() == 1 {
        return Some(hits[0]);
    }
    let deg = deg.rem_euclid(360.0);
    let mut ahead: Option<(f64, DVec2)> = None;
    let mut behind: Option<(f64, DVec2)> = None;
    for h in hits {
        if geom::same_point(h, p) {
            continue;
        }
        let d = p.distance(h);
        let slot = if (geom::angle(p, h) - deg).abs() < 0.1 {
            &mut ahead
        } else {
            &mut behind
        };
        if slot.is_none_or(|(best, _)| d < best) {
            *slot = Some((d, h));
        }
    }
    ahead
        .or(behind)
        .map(|x| x.1)
        .or_else(|| on_curve().then_some(p))
}

/// Where two curves cross; of several, the highest (1) or lowest (2), then the leftmost (1)
/// or rightmost (2).
fn curves_cross(c1: &[DVec2], c2: &[DVec2], v: i32, h: i32) -> Option<DVec2> {
    let mut hits = Vec::new();
    for w in c1.windows(2) {
        hits.extend(polyline_line(c2, w[0], w[1]));
    }
    let first = *hits.first()?;
    let best_y = hits
        .iter()
        .map(|p| p.y)
        .fold(first.y, |a, b| if v == 1 { a.min(b) } else { a.max(b) });
    let row: Vec<DVec2> = hits
        .into_iter()
        .filter(|p| geom::fuzzy_eq(p.y, best_y))
        .collect();
    row.into_iter().reduce(|a, b| {
        let better = if h == 2 { b.x > a.x } else { b.x < a.x };
        if better { b } else { a }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    fn draft(calc: &str) -> Draft {
        let text = format!(
            r##"<pattern><version>0.9.2</version><unit>cm</unit>
            <increments><increment name="#w" formula="10"/></increments>
            <draw name="A"><calculation>{calc}</calculation><modeling/></draw></pattern>"##
        );
        let doc = Document::parse(&text).unwrap();
        let p = Pattern::read(&doc).unwrap();
        let mut m = HashMap::new();
        m.insert("hip_circ".to_string(), 100.0);
        Draft::run(&p, m)
    }

    /// A point in cm, y up (as a drafter reads it).
    fn at(d: &Draft, id: u32) -> DVec2 {
        let p = d.point(id).unwrap().p;
        DVec2::new(d.from_px(p.x), -d.from_px(p.y))
    }

    fn near(a: DVec2, b: DVec2) -> bool {
        a.distance(b) < 1e-6
    }

    const BASE: &str = r##"
        <point type="single" id="1" name="A" x="0" y="0"/>
        <point type="endLine" id="2" name="B" basePoint="1" angle="0" length="hip_circ/10"/>
        <point type="endLine" id="3" name="C" basePoint="1" angle="90" length="#w"/>"##;

    #[test]
    fn line_tools() {
        let d = draft(&format!(
            r##"{BASE}
            <point type="alongLine" id="4" name="D" firstPoint="1" secondPoint="2" length="Line_A_B/2"/>
            <point type="normal" id="5" name="E" firstPoint="1" secondPoint="2" length="3" angle="0"/>
            <point type="bisector" id="6" name="F" firstPoint="2" secondPoint="1" thirdPoint="3" length="sqrt(2)"/>
            <point type="pointOfIntersection" id="7" name="G" firstPoint="2" secondPoint="3"/>
            <point type="height" id="8" name="H" basePoint="7" p1Line="1" p2Line="2"/>
            <point type="lineIntersect" id="9" name="I" p1Line1="1" p2Line1="7" p1Line2="2" p2Line2="3"/>
            <point type="lineIntersectAxis" id="10" name="J" basePoint="3" angle="AngleLine_A_B" p1Line="2" p2Line="7"/>
            <point type="shoulder" id="11" name="K" p1Line="1" p2Line="4" pShoulder="3" length="Line_C_B"/>"##
        ));
        assert!(d.unavailable.is_empty(), "{:?}", d.unavailable);
        assert!(near(at(&d, 2), DVec2::new(10.0, 0.0)));
        assert!(near(at(&d, 3), DVec2::new(0.0, 10.0)));
        assert!(near(at(&d, 4), DVec2::new(5.0, 0.0)));
        assert!(near(at(&d, 5), DVec2::new(0.0, 3.0)));
        assert!(near(at(&d, 6), DVec2::new(1.0, 1.0)));
        assert!(near(at(&d, 7), DVec2::new(10.0, 10.0)));
        assert!(near(at(&d, 8), DVec2::new(10.0, 0.0)));
        assert!(near(at(&d, 9), DVec2::new(5.0, 5.0)));
        assert!(near(at(&d, 10), DVec2::new(10.0, 10.0)));
        // On A→D beyond D, sqrt(200) from C: x = 10.
        assert!(near(at(&d, 11), DVec2::new(10.0, 0.0)));
    }

    #[test]
    fn circle_tools() {
        let d = draft(&format!(
            r##"{BASE}
            <point type="pointOfIntersectionCircles" id="4" name="D" c1Center="1" c2Center="2" c1Radius="10" c2Radius="10" crossPoint="1"/>
            <point type="pointOfIntersectionCircles" id="5" name="E" c1Center="1" c2Center="2" c1Radius="10" c2Radius="10" crossPoint="2"/>
            <point type="pointFromCircleAndTangent" id="6" name="F" cCenter="1" tangent="2" cRadius="5" crossPoint="1"/>
            <point type="pointOfContact" id="7" name="G" center="1" firstPoint="2" secondPoint="3" radius="sqrt(50)"/>
            <arc type="simple" id="8" center="1" radius="10" angle1="0" angle2="180"/>
            <arc type="simple" id="9" center="2" radius="10" angle1="90" angle2="270"/>
            <point type="pointOfIntersectionArcs" id="10" name="H" firstArc="8" secondArc="9" crossPoint="2"/>
            <point type="cutArc" id="11" name="I" arc="8" length="Arc_A_8/2"/>"##
        ));
        assert!(d.unavailable.is_empty(), "{:?}", d.unavailable);
        let h = 75f64.sqrt();
        let (p4, p5) = (at(&d, 4), at(&d, 5));
        assert!(near(p4, DVec2::new(5.0, h)) || near(p4, DVec2::new(5.0, -h)));
        assert!(near(p5, DVec2::new(p4.x, -p4.y)));
        let f = at(&d, 6);
        assert!((f.length() - 5.0).abs() < 1e-6);
        assert!(near(at(&d, 7), DVec2::new(5.0, 5.0)));
        // Only the upper crossing lies on both arcs.
        assert!(near(at(&d, 10), DVec2::new(5.0, h)));
        assert!(at(&d, 11).distance(DVec2::new(0.0, 10.0)) < 1e-3);
        assert!((d.value("Arc_A_8").unwrap() - 10.0 * std::f64::consts::PI).abs() < 1e-3);
        assert!((d.value("RadiusArc_A_8").unwrap() - 10.0).abs() < 1e-9);
    }

    #[test]
    fn curves_and_cuts() {
        let d = draft(&format!(
            r##"{BASE}
            <point type="endLine" id="4" name="D" basePoint="2" angle="90" length="10"/>
            <spline type="simpleInteractive" id="5" point1="3" point4="2" angle1="0" angle2="90" length1="5" length2="5" alias="side"/>
            <spline type="simple" id="6" point1="1" point4="2" angle1="45" angle2="135" kAsm1="1" kAsm2="1" kCurve="1"/>
            <spline type="pathInteractive" id="7">
                <pathPoint pSpline="1" angle1="180" angle2="0" length1="0" length2="2"/>
                <pathPoint pSpline="2" angle1="180" angle2="90" length1="2" length2="2"/>
                <pathPoint pSpline="4" angle1="270" angle2="90" length1="2" length2="0"/>
            </spline>
            <point type="cutSpline" id="8" name="E" spline="5" length="Spl_side/2"/>
            <point type="cutSplinePath" id="9" name="F" splinePath="7" length="-10"/>
            <point type="curveIntersectAxis" id="10" name="G" basePoint="1" curve="5" angle="45"/>"##
        ));
        assert!(d.unavailable.is_empty(), "{:?}", d.unavailable);
        assert_eq!(d.value("Spl_side"), d.value("Spl_C_B"));
        assert!((d.value("C1LengthSpl_C_B").unwrap() - 5.0).abs() < 1e-9);
        assert!((d.value("Angle2Spl_C_B").unwrap() - 90.0).abs() < 1e-9);
        // A straight path A → B → D is 20 long; 10 from the end is B.
        assert!((d.value("SplPath_A_D").unwrap() - 20.0).abs() < 1e-6);
        assert!(at(&d, 9).distance(DVec2::new(10.0, 0.0)) < 1e-4);
        // The cut's pieces have values under derived names.
        let half = d.value("Spl_C_E").unwrap();
        assert!((half - d.value("Spl_E_B").unwrap()).abs() < 1e-4);
        // A symmetric spline: the axis at 45° from A meets it on the diagonal.
        let g = at(&d, 10);
        assert!((g.x - g.y).abs() < 1e-3, "{g}");
        // The old spline bulges up.
        let old = d.curve(6).unwrap();
        assert!(old.points().iter().any(|p| p.y < -1.0));
    }

    #[test]
    fn operations_copy_with_suffixes() {
        let d = draft(&format!(
            r##"{BASE}
            <operation type="rotation" id="4" center="1" angle="90" suffix="r">
                <source><item idObject="2"/></source>
                <destination><item idObject="5"/></destination>
            </operation>
            <operation type="flippingByAxis" id="6" center="1" axisType="1" suffix="m">
                <source><item idObject="2"/></source>
                <destination><item idObject="7"/></destination>
            </operation>
            <operation type="moving" id="8" angle="0" length="1" rotationAngle="0" suffix="v">
                <source><item idObject="3"/></source>
                <destination><item idObject="9"/></destination>
            </operation>
            <point type="alongLine" id="10" name="X" firstPoint="1" secondPoint="5" length="Line_A_Br"/>"##
        ));
        assert!(d.unavailable.is_empty(), "{:?}", d.unavailable);
        assert!(near(at(&d, 5), DVec2::new(0.0, 10.0)));
        assert!(near(at(&d, 7), DVec2::new(-10.0, 0.0)));
        assert!(near(at(&d, 9), DVec2::new(1.0, 10.0)));
        assert_eq!(d.point(9).unwrap().name, "Cv");
        assert!(near(at(&d, 10), DVec2::new(0.0, 10.0)));
    }

    #[test]
    fn failures_spread_to_dependants_only() {
        let d = draft(&format!(
            r##"{BASE}
            <point type="endLine" id="4" name="D" basePoint="1" angle="0" length="waist_circ"/>
            <point type="alongLine" id="5" name="E" firstPoint="4" secondPoint="2" length="1"/>
            <point type="pointOfIntersectionCircles" id="6" name="F" c1Center="1" c2Center="2" c1Radius="1" c2Radius="1"/>
            <elArc type="simple" id="7" center="1"/>
            <point type="alongLine" id="8" name="G" firstPoint="1" secondPoint="2" length="1"/>"##
        ));
        assert!(d.unavailable[&4].contains("waist_circ"));
        assert!(d.unavailable[&5].contains("failed"));
        assert!(d.unavailable[&6].contains("don't meet"));
        assert!(d.unavailable[&7].contains("elliptical"));
        assert!(d.point(8).is_ok());
    }
}
