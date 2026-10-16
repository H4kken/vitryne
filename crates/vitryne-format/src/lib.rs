// SPDX-License-Identifier: AGPL-3.0-or-later
//! The Vitryne file format, version 2: the specification is [docs/FORMAT.md], the JSON Schemas
//! in docs/format/schema/ check what this crate writes.
//!
//! ```ignore
//! let opened = Document::open(Path::new("examples/tshirt.vtry"))?;   // zip or folder
//! for w in &opened.warnings { log::warn!("{w}") }
//! let mut doc = opened.doc;
//! doc.fabrics[0].friction = 0.4;
//! doc.save(Path::new("out.vtry"))?;
//! ```
//!
//! What it does: reads and writes the container (zip or folder), migrates older files on their
//! raw JSON, parses the parts into the types of `model`, checks the rules a schema can't express
//! (references, unique ids), and keeps everything it doesn't understand (unknown members, parts,
//! extensions) so a newer file survives a round trip. Nothing here knows about the engine:
//! `drape-assets` turns a document into something to simulate.
//!
//! [docs/FORMAT.md]: ../../../docs/FORMAT.md

pub mod container;
mod document;
mod entities;
pub mod glb;
pub mod id;
pub mod json;
pub mod manifest;
pub mod migrate;
pub mod model;
pub mod presets;
mod validate;

pub use document::{Document, File, Opened};
pub use entities::Entities;
pub use id::{Id, IdGen};
pub use manifest::Kind;
pub use model::*;
pub use validate::Report;

/// The version this crate reads and writes.
pub const FORMAT_VERSION: u32 = 2;
/// The `minReaderVersion` it writes: the oldest reader that can open its files correctly.
pub const MIN_READER_VERSION: u32 = 1;
/// The extensions this reader implements (a file requiring any other is refused).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[];
pub const GENERATOR: &str = concat!("vitryne-format ", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// Not a Vitryne file, or damaged: what is wrong.
    Malformed(String),
    /// Made with a newer Vitryne: the file needs reader version `min_reader`.
    TooNew {
        min_reader: u32,
    },
    /// Needs extensions this reader doesn't implement.
    Unsupported(Vec<String>),
    /// Parses, but breaks the format's rules (references, ids, ...): every problem found.
    Invalid(Vec<String>),
    Io(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Malformed(m) => write!(f, "not a valid Vitryne file: {m}"),
            Error::TooNew { min_reader } => write!(
                f,
                "made with a newer Vitryne (needs format version {min_reader}, this one reads {FORMAT_VERSION})"
            ),
            Error::Unsupported(ext) => {
                write!(f, "needs extensions this Vitryne lacks: {}", ext.join(", "))
            }
            Error::Invalid(errs) => write!(f, "invalid Vitryne file: {}", errs.join("; ")),
            Error::Io(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<Error> for String {
    fn from(e: Error) -> String {
        e.to_string()
    }
}
