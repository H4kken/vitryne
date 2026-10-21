// SPDX-License-Identifier: AGPL-3.0-or-later
//! Identifiers (FORMAT.md, Identifiers): UUIDs, lowercase and hyphenated, unique within a file.
//! Writers create version 7 (time-ordered); readers accept any version.

use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Id(String);

impl Id {
    /// Accepts `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, lowercase hex, any version.
    pub fn parse(s: &str) -> Result<Id, String> {
        let ok = s.len() == 36
            && s.bytes().enumerate().all(|(i, b)| match i {
                8 | 13 | 18 | 23 => b == b'-',
                _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
            });
        if ok {
            Ok(Id(s.to_string()))
        } else {
            Err(format!("{s:?} is not an id (a lowercase, hyphenated UUID)"))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn from_bytes(b: [u8; 16]) -> Id {
        let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
        Id(format!(
            "{}-{}-{}-{}-{}",
            &h[..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..]
        ))
    }
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Id::parse(&s).map_err(serde::de::Error::custom)
    }
}

/// Makes version-7 ids (RFC 9562): a millisecond timestamp, then random bits. The timestamp
/// starts at `unix_ms` and advances by 1 ms per id, so ids sort in creation order; the random
/// bits are SHA-256 of the seed and a counter. The same arguments give the same ids, which
/// keeps converted files stable from one run to the next; an app passes the current time and
/// fresh random bytes.
pub struct IdGen {
    ms: u64,
    seed: Vec<u8>,
    n: u64,
}

impl IdGen {
    pub fn new(unix_ms: u64, seed: &[u8]) -> Self {
        Self {
            ms: unix_ms,
            seed: seed.to_vec(),
            n: 0,
        }
    }

    pub fn next_id(&mut self) -> Id {
        self.n += 1;
        let mut h = Sha256::new();
        h.update(&self.seed);
        h.update(self.n.to_le_bytes());
        let r = h.finalize();
        let mut b = [0u8; 16];
        b[..6].copy_from_slice(&(self.ms + self.n).to_be_bytes()[2..]);
        b[6..].copy_from_slice(&r[..10]);
        b[6] = 0x70 | (b[6] & 0x0f);
        b[8] = 0x80 | (b[8] & 0x3f);
        Id::from_bytes(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v7_ids_are_valid_ordered_and_reproducible() {
        let mut g = IdGen::new(1_792_022_400_000, b"tshirt");
        let a = g.next_id();
        let b = g.next_id();
        assert!(a < b);
        assert_eq!(&a.as_str()[14..15], "7");
        assert!(matches!(&a.as_str()[19..20], "8" | "9" | "a" | "b"));
        assert_eq!(Id::parse(a.as_str()), Ok(a.clone()));
        assert_eq!(IdGen::new(1_792_022_400_000, b"tshirt").next_id(), a);
        assert!(Id::parse("01A13CDB-CC03-713C-9796-120438B8BA92").is_err());
        assert!(Id::parse("front").is_err());
    }
}
