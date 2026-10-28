// SPDX-License-Identifier: AGPL-3.0-or-later
//! The layout of a pattern file: its version, unit, measurements file, increments and draft
//! blocks. Each block holds the drafting tools in order (`calculation`), copies of the objects
//! its pieces use (`modeling`) and the pieces (`details`).
//!
//! Seamly2D keeps the same layout under other names; a `Dialect` maps them.

use roxmltree::{Document, Node};

use super::{Unit, child, child_text, version};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Valentina,
}

impl Dialect {
    /// A draft block.
    pub fn block(self) -> &'static str {
        match self {
            Dialect::Valentina => "draw",
        }
    }

    pub fn pieces(self) -> &'static str {
        match self {
            Dialect::Valentina => "details",
        }
    }

    pub fn piece(self) -> &'static str {
        match self {
            Dialect::Valentina => "detail",
        }
    }

    /// Pattern-wide named values (`#name`).
    pub fn increments(self) -> &'static [&'static str] {
        match self {
            Dialect::Valentina => &["increments", "previewCalculations"],
        }
    }

    pub fn increment(self) -> &'static str {
        match self {
            Dialect::Valentina => "increment",
        }
    }
}

/// The oldest pattern format read: Valentina 0.2.0 (2015). Older files used other measurement
/// names.
pub const MIN_VERSION: (u32, u32, u32) = (0, 2, 0);

/// A pattern file read for its layout.
pub struct Pattern<'a, 'i> {
    pub dialect: Dialect,
    pub version: (u32, u32, u32),
    pub unit: Unit,
    /// The measurements file as the author's app saved it (a path on their disk), if any.
    pub measurements: Option<String>,
    /// `#name = formula`, in order.
    pub increments: Vec<(String, String)>,
    pub blocks: Vec<Node<'a, 'i>>,
}

impl<'a, 'i> Pattern<'a, 'i> {
    pub fn read(doc: &'a Document<'i>) -> Result<Self, String> {
        let root = doc.root_element();
        let dialect = match root.tag_name().name() {
            "pattern" => Dialect::Valentina,
            other => return Err(format!("not a pattern file (<{other}>)")),
        };
        let version = version(root)?;
        if version < MIN_VERSION {
            return Err(format!(
                "this pattern is from before Valentina 0.2 (format {}.{}.{}); open it in Valentina and save it again",
                version.0, version.1, version.2
            ));
        }
        let unit = Unit::parse(child_text(root, "unit").ok_or("no <unit>")?)?;
        // Since 0.9.1 the path is an attribute; before, the element's text.
        let measurements = child(root, "measurements")
            .and_then(|m| m.attribute("path").or(m.text()))
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(str::to_string);
        let mut increments = Vec::new();
        for tag in dialect.increments() {
            if let Some(list) = child(root, tag) {
                for inc in list
                    .children()
                    .filter(|c| c.has_tag_name(dialect.increment()))
                {
                    if inc.attribute("type") == Some("separator") {
                        continue;
                    }
                    let name = inc.attribute("name").ok_or("an increment without a name")?;
                    increments.push((
                        name.trim().to_string(),
                        inc.attribute("formula").unwrap_or("0").to_string(),
                    ));
                }
            }
        }
        let blocks = root
            .children()
            .filter(|c| c.has_tag_name(dialect.block()))
            .collect();
        Ok(Self {
            dialect,
            version,
            unit,
            measurements,
            increments,
            blocks,
        })
    }

    /// The file name of the measurements file (the author's path stripped), as the import
    /// dialog asks for it.
    pub fn measurements_file_name(&self) -> Option<&str> {
        self.measurements
            .as_deref()
            .map(|p| p.rsplit(['/', '\\']).next().unwrap_or(p))
    }

    /// Every block's section `name` (`calculation`, `modeling`), in file order.
    pub fn sections(&self, name: &str) -> Vec<Node<'a, 'i>> {
        self.blocks.iter().filter_map(|b| child(*b, name)).collect()
    }

    /// Every piece of every block, with its block's name.
    pub fn pieces(&self) -> Vec<(Option<&'a str>, Node<'a, 'i>)> {
        let mut out = Vec::new();
        for b in &self.blocks {
            if let Some(ds) = child(*b, self.dialect.pieces()) {
                for d in ds
                    .children()
                    .filter(|c| c.has_tag_name(self.dialect.piece()))
                {
                    out.push((b.attribute("name"), d));
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATTERN: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<pattern>
    <version>0.9.2</version>
    <unit>cm</unit>
    <measurements path="../../tables/Keiko.vit"/>
    <increments>
        <increment name="#ease" formula="2"/>
        <increment type="separator" name="#sep"/>
        <increment name="#half" formula="#ease / 2"/>
    </increments>
    <previewCalculations>
        <increment name="#tmp" formula="1"/>
    </previewCalculations>
    <draw name="Front">
        <calculation><point type="single" id="1" name="A" x="0" y="0"/></calculation>
        <modeling/>
        <details><detail id="9" name="Front"/></details>
    </draw>
    <draw name="Back"><calculation/></draw>
</pattern>"##;

    #[test]
    fn reads_the_layout() {
        let doc = Document::parse(PATTERN).unwrap();
        let p = Pattern::read(&doc).unwrap();
        assert_eq!(p.version, (0, 9, 2));
        assert_eq!(p.unit, Unit::Cm);
        assert_eq!(p.measurements_file_name(), Some("Keiko.vit"));
        assert_eq!(
            p.increments,
            vec![
                ("#ease".to_string(), "2".to_string()),
                ("#half".to_string(), "#ease / 2".to_string()),
                ("#tmp".to_string(), "1".to_string()),
            ]
        );
        assert_eq!(p.blocks.len(), 2);
        assert_eq!(p.sections("calculation").len(), 2);
        assert_eq!(p.pieces().len(), 1);
        assert_eq!(p.pieces()[0].0, Some("Front"));
    }

    #[test]
    fn refuses_other_files() {
        let old = PATTERN.replace("0.9.2", "0.1.4");
        let doc = Document::parse(&old).unwrap();
        assert!(Pattern::read(&doc).err().unwrap().contains("save it again"));
        let doc = Document::parse("<vit><version>0.3.3</version></vit>").unwrap();
        assert!(Pattern::read(&doc).is_err());
    }
}
