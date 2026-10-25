// SPDX-License-Identifier: AGPL-3.0-or-later
//! Body measurements: Valentina's individual (`.vit`) and multisize (`.vst`) files.
//!
//! An individual file gives one value per measurement, as a formula that may use the
//! measurements before it. A multisize file is a size chart: up to three dimensions (height,
//! chest, waist, hip: `x`, `y`, `w`, `z`), each with a base, a range and a step, and per
//! measurement a base value and a shift per step of each dimension, plus optional corrections
//! for one combination of sizes:
//!
//! `value = base + Σ (chosen − dimension base) / step × shift + correction`
//!
//! Values are converted to the pattern's unit, except "special units" (angles, percentages).
//! Older files: `.vst` 0.4 had a fixed height (A, step 6 cm) and size (B, step 2 cm) instead of
//! dimensions, read the same way; `.vit` before 0.3.3 (2015) used other measurement names, so
//! it is refused with a hint to re-save it.

use std::collections::BTreeMap;

use roxmltree::{Document, Node};

use super::{Unit, attr_f64, child, child_text, formula, version};

#[derive(Debug, Clone, PartialEq)]
pub struct Dimension {
    /// `x` height, `y` chest, `w` waist, `z` hip.
    pub kind: char,
    pub base: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    /// The chart's own name for it, if any.
    pub name: Option<String>,
    /// Labels for some values ("M", "40").
    pub labels: Vec<(f64, String)>,
}

impl Dimension {
    /// Every value it offers, `min` to `max` by `step`.
    pub fn values(&self) -> Vec<f64> {
        if self.step <= 0.0 {
            return vec![self.base];
        }
        let n = ((self.max - self.min) / self.step).round() as usize;
        (0..=n).map(|k| self.min + k as f64 * self.step).collect()
    }

    pub fn label(&self) -> &str {
        if let Some(n) = &self.name {
            return n;
        }
        match self.kind {
            'x' => "height",
            'y' => "chest",
            'w' => "waist",
            'z' => "hip",
            _ => "size",
        }
    }
}

#[derive(Debug, Clone)]
enum Value {
    Formula(String),
    Graded {
        base: f64,
        shifts: [f64; 3],
        /// (sizes, correction).
        corrections: Vec<(Vec<f64>, f64)>,
    },
}

#[derive(Debug, Clone)]
struct Item {
    name: String,
    value: Value,
    special_units: bool,
}

#[derive(Debug, Clone)]
pub struct Measurements {
    pub unit: Unit,
    /// Empty for an individual file.
    pub dimensions: Vec<Dimension>,
    items: Vec<Item>,
}

fn read_items(root: Node, multisize: bool) -> Result<Vec<Item>, String> {
    let body = child(root, "body-measurements").ok_or("no <body-measurements>")?;
    let mut items = Vec::new();
    for m in body.children().filter(|c| c.has_tag_name("m")) {
        if m.attribute("type") == Some("separator") {
            continue;
        }
        let name = m
            .attribute("name")
            .ok_or("a measurement without a name")?
            .trim()
            .to_string();
        let special_units = m.attribute("specialUnits") == Some("true");
        let value = if multisize {
            // 0.4 files: height_increase and size_increase are shifts A and B.
            let shift = |new: &str, old: &str| -> Result<f64, String> {
                match m.attribute(new) {
                    Some(_) => attr_f64(m, new, 0.0),
                    None => attr_f64(m, old, 0.0),
                }
            };
            let mut corrections = Vec::new();
            if let Some(cs) = child(m, "corrections") {
                for c in cs.children().filter(|c| c.has_tag_name("correction")) {
                    let sizes = c
                        .attribute("coordinates")
                        .unwrap_or("")
                        .split(';')
                        .map(|s| s.trim().parse::<f64>())
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|_| format!("{name}: bad correction coordinates"))?;
                    corrections.push((sizes, attr_f64(c, "correction", 0.0)?));
                }
            }
            Value::Graded {
                base: attr_f64(m, "base", 0.0)?,
                shifts: [
                    shift("shiftA", "height_increase")?,
                    shift("shiftB", "size_increase")?,
                    shift("shiftC", "")?,
                ],
                corrections,
            }
        } else {
            Value::Formula(m.attribute("value").unwrap_or("0").to_string())
        };
        items.push(Item {
            name,
            value,
            special_units,
        });
    }
    Ok(items)
}

fn read_dimensions(root: Node, unit: Unit) -> Result<Vec<Dimension>, String> {
    if let Some(dims) = child(root, "dimensions") {
        let mut out = Vec::new();
        for d in dims.children().filter(|c| c.has_tag_name("dimension")) {
            let kind = d
                .attribute("type")
                .and_then(|t| t.chars().next())
                .ok_or("a dimension without a type")?;
            let labels = child(d, "labels")
                .map(|ls| {
                    ls.children()
                        .filter(|c| c.has_tag_name("label"))
                        .map(|l| {
                            Ok((
                                attr_f64(l, "value", 0.0)?,
                                l.attribute("label").unwrap_or("").to_string(),
                            ))
                        })
                        .collect::<Result<Vec<_>, String>>()
                })
                .transpose()?
                .unwrap_or_default();
            out.push(Dimension {
                kind,
                base: attr_f64(d, "base", 0.0)?,
                min: attr_f64(d, "min", 0.0)?,
                max: attr_f64(d, "max", 0.0)?,
                step: attr_f64(d, "step", 0.0)?,
                name: d
                    .attribute("customName")
                    .filter(|n| !n.is_empty())
                    .map(str::to_string),
                labels,
            });
        }
        if out.is_empty() || out.len() > 3 {
            return Err(format!(
                "a size chart has 1 to 3 dimensions, not {}",
                out.len()
            ));
        }
        return Ok(out);
    }
    // 0.4: <height base=".."/> and <size base=".."/>, on Valentina's fixed grids.
    let base = |tag: &str| -> Result<f64, String> {
        child(root, tag)
            .map(|n| attr_f64(n, "base", 0.0))
            .transpose()
            .map(|v| v.unwrap_or(0.0))
    };
    let cm = |v: f64| Unit::Cm.convert(v, unit).trunc();
    Ok(vec![
        Dimension {
            kind: 'x',
            base: base("height")?,
            min: cm(50.0),
            max: cm(200.0),
            step: cm(6.0),
            name: None,
            labels: Vec::new(),
        },
        Dimension {
            kind: 'y',
            base: base("size")?,
            min: cm(22.0),
            max: cm(72.0),
            step: cm(2.0),
            name: None,
            labels: Vec::new(),
        },
    ])
}

impl Measurements {
    /// Reads a `.vit` or `.vst` (told apart by the root element).
    pub fn read(text: &str) -> Result<Self, String> {
        let doc = Document::parse(text).map_err(|e| format!("not a measurements file: {e}"))?;
        let root = doc.root_element();
        let multisize = match root.tag_name().name() {
            "vit" => false,
            "vst" => true,
            other => return Err(format!("not a measurements file (<{other}>)")),
        };
        let v = version(root)?;
        if !multisize && v < (0, 3, 3) {
            return Err(format!(
                "this measurements file is from Valentina before 0.4 (format {}.{}.{}); open it in Valentina or Tape and save it again",
                v.0, v.1, v.2
            ));
        }
        if multisize && v < (0, 4, 0) {
            return Err(format!(
                "this size chart is from Valentina before 0.4 (format {}.{}.{}); open it in Tape and save it again",
                v.0, v.1, v.2
            ));
        }
        let unit = Unit::parse(child_text(root, "unit").ok_or("no <unit>")?)?;
        Ok(Self {
            unit,
            dimensions: if multisize {
                read_dimensions(root, unit)?
            } else {
                Vec::new()
            },
            items: read_items(root, multisize)?,
        })
    }

    pub fn is_multisize(&self) -> bool {
        !self.dimensions.is_empty()
    }

    /// The chart's base size, one value per dimension.
    pub fn base_size(&self) -> Vec<f64> {
        self.dimensions.iter().map(|d| d.base).collect()
    }

    /// Every measurement's value in `unit`, for `size` (one value per dimension; ignored for
    /// an individual file).
    pub fn values(&self, size: &[f64], unit: Unit) -> Result<BTreeMap<String, f64>, String> {
        if self.is_multisize() {
            if size.len() != self.dimensions.len() {
                return Err(format!(
                    "the size chart has {} dimensions, {} values given",
                    self.dimensions.len(),
                    size.len()
                ));
            }
            for (d, &v) in self.dimensions.iter().zip(size) {
                let on_step = d.step <= 0.0
                    || (((v - d.min) / d.step).round() * d.step + d.min - v).abs() < 1e-6;
                if v < d.min - 1e-9 || v > d.max + 1e-9 || !on_step {
                    return Err(format!("{} {v} is not in the size chart", d.label()));
                }
            }
        }
        let mut file_unit: BTreeMap<String, f64> = BTreeMap::new();
        let mut out = BTreeMap::new();
        for it in &self.items {
            let v = match &it.value {
                Value::Formula(f) => {
                    let known = |n: &str| file_unit.get(n).copied();
                    formula::eval(f, &known).map_err(|e| format!("measurement {}: {e}", it.name))?
                }
                Value::Graded {
                    base,
                    shifts,
                    corrections,
                } => {
                    let mut v = *base;
                    for (k, d) in self.dimensions.iter().enumerate() {
                        if d.step > 0.0 {
                            v += (size[k] - d.base) / d.step * shifts[k];
                        }
                    }
                    v + corrections
                        .iter()
                        .find(|(at, _)| {
                            at.len() == size.len()
                                && at.iter().zip(size).all(|(a, b)| (a - b).abs() < 1e-6)
                        })
                        .map_or(0.0, |c| c.1)
                }
            };
            file_unit.insert(it.name.clone(), v);
            let v = if it.special_units {
                v
            } else {
                self.unit.convert(v, unit)
            };
            out.insert(it.name.clone(), v);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<vit>
    <version>0.6.2</version>
    <read-only>false</read-only>
    <unit>cm</unit>
    <pm_system></pm_system>
    <personal/>
    <body-measurements>
        <m name="hip_circ" value="100"/>
        <m type="separator" name="sep"/>
        <m name="waist_circ" value="hip_circ - 28"/>
        <m name="@half" value="(waist_circ + hip_circ) / 2"/>
        <m name="@angle" value="15" specialUnits="true"/>
    </body-measurements>
</vit>"#;

    /// Valentina 0.4 chart, in the shape of its GOST tables.
    const VST_04: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<vst>
    <version>0.4.2</version>
    <read-only>false</read-only>
    <unit>mm</unit>
    <pm_system>51</pm_system>
    <size base="500"/>
    <height base="1760"/>
    <body-measurements>
        <m name="height" base="1760" size_increase="0" height_increase="60"/>
        <m name="bust_circ" base="1044" size_increase="38" height_increase="2"/>
    </body-measurements>
</vst>"#;

    const VST_06: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<vst>
    <version>0.6.2</version>
    <read-only>false</read-only>
    <unit>cm</unit>
    <pm_system></pm_system>
    <dimensions fullCircumference="true">
        <dimension type="x" base="170" min="158" max="182" step="6"/>
        <dimension type="y" base="96" min="84" max="108" step="4" customName="chest">
            <labels><label value="96" label="M"/></labels>
        </dimension>
    </dimensions>
    <restrictions/>
    <body-measurements>
        <m name="waist_circ" base="80" shiftA="0.5" shiftB="4">
            <corrections><correction coordinates="176;100" correction="0.3"/></corrections>
        </m>
        <m name="@ease" base="2" specialUnits="true"/>
    </body-measurements>
</vst>"#;

    #[test]
    fn individual_values_are_formulas_in_order() {
        let m = Measurements::read(VIT).unwrap();
        assert!(!m.is_multisize());
        let v = m.values(&[], Unit::Mm).unwrap();
        assert_eq!(v["hip_circ"], 1000.0);
        assert_eq!(v["waist_circ"], 720.0);
        assert_eq!(v["@half"], 860.0);
        // Not converted.
        assert_eq!(v["@angle"], 15.0);
        assert!(!v.contains_key("sep"));
    }

    #[test]
    fn old_charts_grade_by_height_and_size() {
        let m = Measurements::read(VST_04).unwrap();
        assert_eq!(m.base_size(), vec![1760.0, 500.0]);
        assert_eq!(m.dimensions[0].step, 60.0);
        assert_eq!(m.dimensions[1].step, 20.0);
        let base = m.values(&[1760.0, 500.0], Unit::Cm).unwrap();
        assert_eq!(base["bust_circ"], 104.4);
        // One height step up and two sizes up.
        let v = m.values(&[1820.0, 540.0], Unit::Cm).unwrap();
        assert!((v["bust_circ"] - (104.4 + 0.2 + 2.0 * 3.8)).abs() < 1e-9);
        assert_eq!(v["height"], 182.0);
    }

    #[test]
    fn dimensions_shifts_and_corrections() {
        let m = Measurements::read(VST_06).unwrap();
        assert_eq!(m.dimensions[1].label(), "chest");
        assert_eq!(
            m.dimensions[0].values(),
            vec![158.0, 164.0, 170.0, 176.0, 182.0]
        );
        let v = m.values(&[176.0, 100.0], Unit::Cm).unwrap();
        assert!((v["waist_circ"] - (80.0 + 0.5 + 4.0 + 0.3)).abs() < 1e-9);
        assert_eq!(v["@ease"], 2.0);
        let e = m.values(&[171.0, 96.0], Unit::Cm).unwrap_err();
        assert!(e.contains("height 171"), "{e}");
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        let old = VIT.replace("0.6.2", "0.2.0");
        assert!(
            Measurements::read(&old)
                .unwrap_err()
                .contains("save it again")
        );
        assert!(Measurements::read("<pattern/>").is_err());
        let bad = VIT.replace("hip_circ - 28", "hips - 28");
        let e = Measurements::read(&bad)
            .unwrap()
            .values(&[], Unit::Cm)
            .unwrap_err();
        assert!(e.contains("waist_circ") && e.contains("hips"), "{e}");
    }
}
