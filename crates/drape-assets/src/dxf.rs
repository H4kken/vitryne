//! Minimal ASCII DXF reader: enough for DXF-AAMA pattern files (R12 or later). Reads the
//! header's units, every BLOCK with its entities, and the INSERTs that place them. Entities it
//! doesn't need (ARC, CIRCLE, SPLINE, MTEXT, HATCH, ...) are skipped and counted, never an error.

use std::collections::BTreeMap;

use glam::DVec2;

#[derive(Debug, Clone, PartialEq)]
pub enum Entity {
    /// POLYLINE (+ VERTEX ... SEQEND) or LWPOLYLINE. `bulges` counts arc segments, which are
    /// imported as straight chords.
    Polyline { layer: String, pts: Vec<DVec2>, closed: bool, bulges: usize },
    Line { layer: String, a: DVec2, b: DVec2 },
    Point { layer: String, p: DVec2 },
    Text { layer: String, p: DVec2, text: String },
}

impl Entity {
    pub fn layer(&self) -> &str {
        match self {
            Entity::Polyline { layer, .. } | Entity::Line { layer, .. } | Entity::Point { layer, .. } | Entity::Text { layer, .. } => layer,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Block {
    pub name: String,
    pub entities: Vec<Entity>,
}

#[derive(Debug, Clone, Default)]
pub struct Dxf {
    /// `$INSUNITS` (0 = unitless, 1 = inch, 4 = mm, 5 = cm, 6 = m), if present.
    pub insunits: Option<i32>,
    pub blocks: Vec<Block>,
    /// Entities in the ENTITIES section other than INSERTs (some writers put pieces there).
    pub entities: Vec<Entity>,
    /// Names of the blocks INSERTed in ENTITIES, in order.
    pub inserts: Vec<String>,
    /// Entity types that were skipped, with counts.
    pub skipped: BTreeMap<String, usize>,
}

impl Dxf {
    /// Metres per drawing unit, from `$INSUNITS` (default: millimetres, the AAMA metric case).
    pub fn unit_m(&self) -> f64 {
        match self.insunits {
            Some(1) => 0.0254,
            Some(2) => 0.3048,
            Some(5) => 0.01,
            Some(6) => 1.0,
            _ => 0.001,
        }
    }
}

/// Group code / value pairs.
fn pairs(text: &str) -> Result<Vec<(i32, &str)>, String> {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let mut out = Vec::with_capacity(lines.len() / 2);
    let mut i = 0;
    while i + 1 < lines.len() {
        if lines[i].is_empty() && lines[i + 1].is_empty() {
            i += 1;
            continue;
        }
        let code = lines[i].parse::<i32>().map_err(|_| format!("line {}: bad group code {:?}", i + 1, lines[i]))?;
        out.push((code, lines[i + 1]));
        i += 2;
    }
    Ok(out)
}

/// One entity's group codes, from its `0` code up to the next `0`.
struct Raw<'a> {
    kind: &'a str,
    codes: Vec<(i32, &'a str)>,
}

impl Raw<'_> {
    fn s(&self, code: i32) -> Option<&str> {
        self.codes.iter().find(|(c, _)| *c == code).map(|(_, v)| *v)
    }
    fn f(&self, code: i32) -> f64 {
        self.s(code).and_then(|v| v.parse().ok()).unwrap_or(0.0)
    }
    fn i(&self, code: i32) -> i32 {
        self.s(code).and_then(|v| v.trim().parse::<f64>().ok()).map(|v| v as i32).unwrap_or(0)
    }
    fn layer(&self) -> String {
        self.s(8).unwrap_or("0").to_string()
    }
}

fn raws<'a>(p: &[(i32, &'a str)]) -> Vec<Raw<'a>> {
    let mut out: Vec<Raw> = Vec::new();
    for &(code, v) in p {
        if code == 0 {
            out.push(Raw { kind: v, codes: Vec::new() });
        } else if let Some(r) = out.last_mut() {
            r.codes.push((code, v));
        }
    }
    out
}

pub fn parse(text: &str) -> Result<Dxf, String> {
    let p = pairs(text)?;
    let rs = raws(&p);
    let mut dxf = Dxf::default();
    let mut section = "";
    let mut block: Option<Block> = None;
    let mut i = 0;
    while i < rs.len() {
        let r = &rs[i];
        i += 1;
        match r.kind {
            "SECTION" => {
                section = r.s(2).unwrap_or("");
                if section == "HEADER" {
                    // Header variables: 9 $NAME followed by their value codes, all in this raw.
                    let mut k = 0;
                    while k < r.codes.len() {
                        if r.codes[k] == (9, "$INSUNITS") {
                            dxf.insunits = r.codes.get(k + 1).and_then(|(_, v)| v.trim().parse::<f64>().ok()).map(|v| v as i32);
                        }
                        k += 1;
                    }
                }
                continue;
            }
            "ENDSEC" => {
                section = "";
                continue;
            }
            "EOF" => break,
            "BLOCK" => {
                block = Some(Block { name: r.s(2).unwrap_or("").to_string(), entities: Vec::new() });
                continue;
            }
            "ENDBLK" => {
                dxf.blocks.extend(block.take());
                continue;
            }
            _ => {}
        }
        if section != "BLOCKS" && section != "ENTITIES" {
            continue;
        }
        let entity = match r.kind {
            "INSERT" if block.is_none() => {
                dxf.inserts.push(r.s(2).unwrap_or("").to_string());
                None
            }
            "POLYLINE" => {
                let mut pts = Vec::new();
                let mut bulges = 0;
                while i < rs.len() && rs[i].kind == "VERTEX" {
                    let v = &rs[i];
                    pts.push(DVec2::new(v.f(10), v.f(20)));
                    bulges += usize::from(v.f(42) != 0.0);
                    i += 1;
                }
                if i < rs.len() && rs[i].kind == "SEQEND" {
                    i += 1;
                }
                Some(Entity::Polyline { layer: r.layer(), pts, closed: r.i(70) & 1 == 1, bulges })
            }
            "LWPOLYLINE" => {
                let xs: Vec<f64> = r.codes.iter().filter(|(c, _)| *c == 10).filter_map(|(_, v)| v.parse().ok()).collect();
                let ys: Vec<f64> = r.codes.iter().filter(|(c, _)| *c == 20).filter_map(|(_, v)| v.parse().ok()).collect();
                let bulges = r.codes.iter().filter(|(c, v)| *c == 42 && v.parse::<f64>().map(|b| b != 0.0).unwrap_or(false)).count();
                Some(Entity::Polyline { layer: r.layer(), pts: xs.iter().zip(&ys).map(|(&x, &y)| DVec2::new(x, y)).collect(), closed: r.i(70) & 1 == 1, bulges })
            }
            "LINE" => Some(Entity::Line { layer: r.layer(), a: DVec2::new(r.f(10), r.f(20)), b: DVec2::new(r.f(11), r.f(21)) }),
            "POINT" => Some(Entity::Point { layer: r.layer(), p: DVec2::new(r.f(10), r.f(20)) }),
            "TEXT" => Some(Entity::Text { layer: r.layer(), p: DVec2::new(r.f(10), r.f(20)), text: r.s(1).unwrap_or("").to_string() }),
            "VERTEX" | "SEQEND" => None,
            other => {
                *dxf.skipped.entry(other.to_string()).or_default() += 1;
                None
            }
        };
        if let Some(e) = entity {
            match block.as_mut() {
                Some(b) => b.entities.push(e),
                None => dxf.entities.push(e),
            }
        }
    }
    Ok(dxf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small file in the shape Seamly2D/Gerber AAMA exports use: an R12 header, a BLOCK with
    /// an old-style POLYLINE, an LWPOLYLINE internal line, a notch, an ARC and an MTEXT (skipped),
    /// and an INSERT.
    const SAMPLE: &str = "  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1009\n  9\n$INSUNITS\n 70\n     5\n  0\nENDSEC\n  0\nSECTION\n  2\nBLOCKS\n  0\nBLOCK\n  8\n1\n  2\nP1\n 70\n     0\n 10\n0.0\n 20\n0.0\n  3\nP1\n  0\nPOLYLINE\n  8\n1\n 66\n     1\n 70\n     1\n  0\nVERTEX\n  8\n1\n 10\n0.0\n 20\n0.0\n  0\nVERTEX\n  8\n1\n 10\n10.0\n 20\n0.0\n  0\nVERTEX\n  8\n1\n 10\n10.0\n 20\n5.0\n 42\n0.3\n  0\nSEQEND\n  8\n1\n  0\nLWPOLYLINE\n  8\n8\n 90\n     2\n 70\n     0\n 10\n1.0\n 20\n1.0\n 10\n2.0\n 20\n1.5\n  0\nLINE\n  8\n4\n 10\n5.0\n 20\n0.0\n 11\n5.0\n 21\n0.4\n  0\nARC\n  8\n1\n 10\n0\n 20\n0\n 40\n1\n  0\nMTEXT\n  8\n1\n  1\nhello\n  0\nTEXT\n  8\n1\n 10\n1\n 20\n1\n 40\n1\n  1\nPiece Name: P1\n  0\nENDBLK\n  8\n1\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n  0\nINSERT\n  8\n1\n  2\nP1\n 10\n100\n 20\n0\n  0\nENDSEC\n  0\nEOF\n";

    #[test]
    fn reads_blocks_entities_and_skips_the_rest() {
        let d = parse(SAMPLE).unwrap();
        assert_eq!(d.insunits, Some(5));
        assert_eq!(d.unit_m(), 0.01);
        assert_eq!(d.inserts, vec!["P1".to_string()]);
        assert_eq!(d.blocks.len(), 1);
        let b = &d.blocks[0];
        assert_eq!(b.name, "P1");
        assert_eq!(b.entities.len(), 4);
        assert!(matches!(&b.entities[0], Entity::Polyline { layer, pts, closed: true, bulges: 1 } if layer == "1" && pts.len() == 3));
        assert!(matches!(&b.entities[1], Entity::Polyline { layer, closed: false, .. } if layer == "8"));
        assert!(matches!(&b.entities[2], Entity::Line { layer, .. } if layer == "4"));
        assert!(matches!(&b.entities[3], Entity::Text { text, .. } if text == "Piece Name: P1"));
        assert_eq!(d.skipped.get("ARC"), Some(&1));
        assert_eq!(d.skipped.get("MTEXT"), Some(&1));
    }

    #[test]
    fn crlf_and_garbage_codes() {
        let d = parse(&SAMPLE.replace('\n', "\r\n")).unwrap();
        assert_eq!(d.blocks[0].entities.len(), 4);
        assert!(parse("  0\nSECTION\nxx\nHEADER\n").is_err());
    }
}
