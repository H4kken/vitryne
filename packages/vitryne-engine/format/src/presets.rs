// SPDX-License-Identifier: AGPL-3.0-or-later
//! Standard fabric presets (packages/vitryne-docs/content/docs/developers/fabrics.md): 5 physical presets covering knit and woven
//! garments, calibrated against textile literature (KES-F / FAST data).

use serde_json::Map;

use crate::{
    id::Id,
    model::{Bending, Category, Fabric, Stretch},
};

pub const ID_COTTON_JERSEY: &str = "01a13cdb-cc03-7001-8000-000000000001";
pub const ID_DENIM: &str = "01a13cdb-cc03-7001-8000-000000000002";
pub const ID_POPLIN: &str = "01a13cdb-cc03-7001-8000-000000000003";
pub const ID_FLEECE: &str = "01a13cdb-cc03-7001-8000-000000000004";
pub const ID_WOOL_SUITING: &str = "01a13cdb-cc03-7001-8000-000000000005";

/// 100% cotton single jersey knit (T-shirt fabric). Soft, stretchy, clinging.
pub fn cotton_jersey() -> Fabric {
    Fabric {
        id: Id::parse(ID_COTTON_JERSEY).unwrap(),
        name: "Cotton jersey".into(),
        category: Category::Knit,
        density: 0.15,
        thickness: Some(0.45),
        stretch: Stretch {
            warp: 14_000.0,
            weft: 9_000.0,
            shear: 3_500.0,
            other: Map::new(),
        },
        bending: Bending {
            warp: 6.0e-6,
            weft: 4.0e-6,
            bias: None,
            other: Map::new(),
        },
        friction: 0.30,
        appearance: None,
        notes: Some(
            "100% cotton single jersey knit, 150 g/m², typical everyday T-shirt. Soft, compliant \
             drape following body contours. Kawabata (1980) Table 2.2; Miguel et al. (2012)."
                .into(),
        ),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    }
}

/// Heavy 3/1 cotton twill denim (12.5 oz/yd²). Stiff, robust, wide tubular folds.
pub fn denim() -> Fabric {
    Fabric {
        id: Id::parse(ID_DENIM).unwrap(),
        name: "Denim".into(),
        category: Category::Woven,
        density: 0.42,
        thickness: Some(0.85),
        stretch: Stretch {
            warp: 1_400_000.0,
            weft: 1_000_000.0,
            shear: 400_000.0,
            other: Map::new(),
        },
        bending: Bending {
            warp: 1.4e-4,
            weft: 1.0e-4,
            bias: None,
            other: Map::new(),
        },
        friction: 0.42,
        appearance: None,
        notes: Some(
            "Heavy 3/1 right-hand twill cotton denim, 420 g/m² (12.5 oz), 5-pocket jeans weight. \
             Stiff, holds shape away from the body in sturdy folds. Kawabata (1980); Breen et al. (1994)."
                .into(),
        ),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    }
}

/// Lightweight plain-weave combed cotton shirting. Crisp, papery fine wrinkles.
pub fn poplin() -> Fabric {
    Fabric {
        id: Id::parse(ID_POPLIN).unwrap(),
        name: "Poplin (shirting)".into(),
        category: Category::Woven,
        density: 0.125,
        thickness: Some(0.22),
        stretch: Stretch {
            warp: 1_100_000.0,
            weft: 800_000.0,
            shear: 300_000.0,
            other: Map::new(),
        },
        bending: Bending {
            warp: 1.8e-5,
            weft: 1.2e-5,
            bias: None,
            other: Map::new(),
        },
        friction: 0.25,
        appearance: None,
        notes: Some(
            "Lightweight combed cotton plain-weave poplin shirting, 125 g/m² (3.7 oz). Crisp hand, \
             fine sharp folds and ripples. Wang et al. (2011) Table 2; FAST-2 standards."
                .into(),
        ),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    }
}

/// Double-faced brushed polyester sweatshirt fleece. Thick, warm, lofty rounded folds.
pub fn fleece() -> Fabric {
    Fabric {
        id: Id::parse(ID_FLEECE).unwrap(),
        name: "Fleece".into(),
        category: Category::Knit,
        density: 0.28,
        thickness: Some(2.20),
        stretch: Stretch {
            warp: 28_000.0,
            weft: 18_000.0,
            shear: 7_500.0,
            other: Map::new(),
        },
        bending: Bending {
            warp: 7.5e-5,
            weft: 5.5e-5,
            bias: None,
            other: Map::new(),
        },
        friction: 0.38,
        appearance: None,
        notes: Some(
            "Double-faced brushed polyester knit fleece, 280 g/m². Lofty and thick (2.2 mm), with \
             rounded, bulky folds and moderate knit give. Kawabata (1980); FAST-1."
                .into(),
        ),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    }
}

/// Worsted wool 2/2 twill suiting cloth. Tailored weight, resilient smooth rolls.
pub fn wool_suiting() -> Fabric {
    Fabric {
        id: Id::parse(ID_WOOL_SUITING).unwrap(),
        name: "Wool suiting".into(),
        category: Category::Woven,
        density: 0.25,
        thickness: Some(0.48),
        stretch: Stretch {
            warp: 850_000.0,
            weft: 650_000.0,
            shear: 200_000.0,
            other: Map::new(),
        },
        bending: Bending {
            warp: 3.2e-5,
            weft: 2.4e-5,
            bias: None,
            other: Map::new(),
        },
        friction: 0.32,
        appearance: None,
        notes: Some(
            "Worsted wool 2/2 twill tailored suiting, 250 g/m² (7.5 oz). Resilient, fluid drape, \
             holding clean creases without limp sagging. Kawabata (1980) Table 2.1; Minami et al. (2002)."
                .into(),
        ),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    }
}

/// The 5 standard presets in canonical order: Cotton jersey, Denim, Poplin, Fleece, Wool suiting.
pub fn presets() -> Vec<Fabric> {
    vec![cotton_jersey(), denim(), poplin(), fleece(), wool_suiting()]
}

/// Finds a preset by its standard id or name (case-insensitive).
pub fn find_preset(id_or_name: &str) -> Option<Fabric> {
    presets()
        .into_iter()
        .find(|p| p.id.as_str() == id_or_name || p.name.eq_ignore_ascii_case(id_or_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::check;
    use std::collections::BTreeMap;

    #[test]
    fn presets_validate() {
        for preset in presets() {
            let doc = crate::Document {
                kind: crate::Kind::Fabric,
                project: None,
                garments: Vec::new(),
                fabrics: vec![preset.clone()],
                appearances: Vec::new(),
                avatars: Vec::new(),
                view: None,
                files: BTreeMap::new(),
                generator: Some("test".into()),
                extensions_used: Vec::new(),
                extensions_required: Vec::new(),
                format_version: crate::FORMAT_VERSION,
                min_reader_version: crate::MIN_READER_VERSION,
                manifest_other: Map::new(),
                part_other: BTreeMap::new(),
            };
            let report = check(&doc);
            assert!(
                report.errors.is_empty(),
                "preset {} has validation errors: {:?}",
                preset.name,
                report.errors
            );
        }
    }
}
