// SPDX-License-Identifier: AGPL-3.0-or-later
//! `manifest.json` and the four kinds of file (file-format.md, Files and kinds, Container).

use serde::{Deserialize, Serialize};

use crate::model::Other;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Project,
    Garment,
    Fabric,
    Avatar,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Project, Kind::Garment, Kind::Fabric, Kind::Avatar];

    /// What the `mimetype` entry holds.
    pub fn media_type(self) -> &'static str {
        match self {
            Kind::Project => "application/vnd.vitryne.project+zip",
            Kind::Garment => "application/vnd.vitryne.garment+zip",
            Kind::Fabric => "application/vnd.vitryne.fabric+zip",
            Kind::Avatar => "application/vnd.vitryne.avatar+zip",
        }
    }

    /// The file extension, with its dot. Only a hint: the manifest says what a file is.
    pub fn extension(self) -> &'static str {
        match self {
            Kind::Project => ".vtry",
            Kind::Garment => ".vtryg",
            Kind::Fabric => ".vtryf",
            Kind::Avatar => ".vtrya",
        }
    }
}

pub const MEDIA_JSON: &str = "application/json";
pub const MEDIA_GLB: &str = "model/gltf-binary";
pub const ROLE_CACHE: &str = "cache";
pub const ROLE_SOURCE: &str = "source";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Always `vitryne`.
    pub format: String,
    pub kind: Kind,
    pub format_version: u32,
    pub min_reader_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator: Option<String>,
    pub parts: Vec<PartEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_used: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_required: Vec<String>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartEntry {
    pub path: String,
    pub media_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// `cache` (derived, may be deleted) or `source` (a kept original).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(flatten)]
    pub other: Other,
}
