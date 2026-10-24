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
pub mod measurements;

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
