// SPDX-License-Identifier: AGPL-3.0-or-later
//! Valentina (`.val`, with `.vit`/`.vst` measurements) and Seamly2D (`.sm2d`, with
//! `.smis`/`.smms`) patterns. Seamly2D forked from Valentina in 2017, so both files are lists of
//! drafting tools whose numbers are formulas (`formula`) over body measurements kept in a
//! separate file (`measurements`).
//!
//! Read from the apps' published schemas and their behaviour (Valentina,
//! <https://gitlab.com/smart-pattern/valentina>; Seamly2D,
//! <https://github.com/FashionFreedom/Seamly2D>; both GPL-3.0). No code is copied from them.

pub mod formula;
pub mod geom;
pub mod measurements;
pub mod pieces;
pub mod tools;
pub mod xml;

use std::collections::HashMap;

use serde::Serialize;

use measurements::{Dimension, Measurements};
use pieces::Shape;
use tools::Draft;
use xml::Pattern;

/// What a pattern needs before it can be read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Needs {
    /// The measurements file it was drafted with (file name only), if any.
    pub measurements: Option<String>,
}

/// One dimension of a size chart, for the size picker.
#[derive(Debug, Clone, Serialize)]
pub struct SizeOption {
    pub label: String,
    pub values: Vec<f64>,
    pub base: f64,
}

/// A pattern read for import.
#[derive(Debug, Clone)]
pub struct Read {
    pub shapes: Vec<Shape>,
    /// Pieces that couldn't be made: (name, why).
    pub refused: Vec<(String, String)>,
    pub warnings: Vec<String>,
    /// A size chart's dimensions (empty for one person's measurements).
    pub sizes: Vec<SizeOption>,
}

fn doc(text: &str) -> Result<roxmltree::Document<'_>, String> {
    roxmltree::Document::parse(text).map_err(|e| format!("not a pattern file: {e}"))
}

pub fn needs(pattern: &str) -> Result<Needs, String> {
    let d = doc(pattern)?;
    let p = Pattern::read(&d)?;
    Ok(Needs {
        measurements: p.measurements_file_name().map(str::to_string),
    })
}

fn size_option(d: &Dimension) -> SizeOption {
    SizeOption {
        label: d.label().to_string(),
        values: d.values(),
        base: d.base,
    }
}

/// Reads a pattern with its measurements file (`measurements`: the file's text) at `size`
/// (one value per dimension of a size chart; its base size if `None`).
pub fn read(
    pattern: &str,
    measurements: Option<&str>,
    size: Option<&[f64]>,
) -> Result<Read, String> {
    let d = doc(pattern)?;
    let p = Pattern::read(&d)?;
    let mut values = HashMap::new();
    let mut sizes = Vec::new();
    match (p.measurements_file_name(), measurements) {
        (Some(name), None) => {
            return Err(format!(
                "this pattern uses the measurements in {name}: add that file"
            ));
        }
        (_, Some(text)) => {
            let m = Measurements::read(text)?;
            let size = size.map(<[f64]>::to_vec).unwrap_or_else(|| m.base_size());
            values.extend(m.values(&size, p.unit)?);
            sizes = m.dimensions.iter().map(size_option).collect();
        }
        (None, None) => {}
    }
    let draft = Draft::run(&p, values);
    let modeling: Vec<roxmltree::Node> = p
        .sections("modeling")
        .iter()
        .flat_map(|m| m.children())
        .filter(|c| c.is_element())
        .collect();
    let (mut shapes, mut refused, mut warnings) = (Vec::new(), Vec::new(), Vec::new());
    for (_, el) in p.pieces() {
        let name = el.attribute("name").unwrap_or("Piece").trim().to_string();
        // Pieces kept out of the layout are drafts or helpers, not cut.
        if el.attribute("inLayout") == Some("false") {
            warnings.push(format!("{name}: not in the layout, left out"));
            continue;
        }
        match pieces::build(&draft, el, &modeling) {
            Ok(mut s) => {
                warnings.append(&mut s.warnings);
                shapes.push(s);
            }
            Err(e) => refused.push((name, e)),
        }
    }
    // Names are how the import refers to pieces: make repeats distinct.
    let mut seen: HashMap<String, usize> = HashMap::new();
    for s in &mut shapes {
        let k = seen.entry(s.name.clone()).or_default();
        *k += 1;
        if *k > 1 {
            s.name = format!("{} ({k})", s.name);
        }
    }
    Ok(Read {
        shapes,
        refused,
        warnings,
        sizes,
    })
}

/// A length unit of a pattern or measurements file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Mm,
    Cm,
    Inch,
}

impl Unit {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim() {
            "mm" => Ok(Unit::Mm),
            "cm" => Ok(Unit::Cm),
            "inch" => Ok(Unit::Inch),
            other => Err(format!("unknown unit \"{other}\"")),
        }
    }

    pub fn mm(self) -> f64 {
        match self {
            Unit::Mm => 1.0,
            Unit::Cm => 10.0,
            Unit::Inch => 25.4,
        }
    }

    /// `v` in this unit, expressed in `to`.
    pub fn convert(self, v: f64, to: Unit) -> f64 {
        v * self.mm() / to.mm()
    }
}

/// A file's `<version>`, as (major, minor, patch).
pub(crate) fn version(root: roxmltree::Node) -> Result<(u32, u32, u32), String> {
    let text = child_text(root, "version").ok_or("no <version>")?;
    let parts: Vec<u32> = text
        .trim()
        .split('.')
        .map(|p| p.parse::<u32>())
        .collect::<Result<_, _>>()
        .map_err(|_| format!("bad version \"{text}\""))?;
    match parts.as_slice() {
        [a, b, c] => Ok((*a, *b, *c)),
        _ => Err(format!("bad version \"{text}\"")),
    }
}

pub(crate) fn child<'a, 'i>(
    node: roxmltree::Node<'a, 'i>,
    name: &str,
) -> Option<roxmltree::Node<'a, 'i>> {
    node.children().find(|c| c.has_tag_name(name))
}

pub(crate) fn child_text<'a>(node: roxmltree::Node<'a, '_>, name: &str) -> Option<&'a str> {
    child(node, name).map(|c| c.text().unwrap_or(""))
}

/// A numeric attribute; missing is `default`, unreadable an error naming it.
pub(crate) fn attr_f64(node: roxmltree::Node, name: &str, default: f64) -> Result<f64, String> {
    match node.attribute(name) {
        None => Ok(default),
        Some(s) if s.trim().is_empty() => Ok(default),
        Some(s) => s.trim().parse().map_err(|_| {
            format!(
                "<{}> {name}=\"{s}\" is not a number",
                node.tag_name().name()
            )
        }),
    }
}
