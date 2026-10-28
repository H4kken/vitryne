// SPDX-License-Identifier: AGPL-3.0-or-later
//! Valentina's own pattern collection through the import (`tools/drafting/corpus.sh` fetches
//! it and runs this): every pattern with its measurements file at its base size. Prints what
//! each made and refused; fails only if a pattern can't be read at all.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use vitryne_pattern::drafting;

fn walk(d: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(d).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else {
            out.push(p);
        }
    }
}

#[test]
#[ignore = "needs Valentina's collection: tools/drafting/corpus.sh"]
fn collection() {
    let root = PathBuf::from(std::env::var("VALENTINA_CORPUS").expect("VALENTINA_CORPUS"));
    let mut all = Vec::new();
    walk(&root, &mut all);
    all.sort();
    let tables: BTreeMap<String, &PathBuf> = all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "vit" || e == "vst"))
        .map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), p))
        .collect();
    let (mut patterns, mut made, mut refused, mut unread) = (0, 0, 0, Vec::new());
    for f in all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "val"))
    {
        patterns += 1;
        let name = f.strip_prefix(&root).unwrap().display().to_string();
        let text = std::fs::read_to_string(f).unwrap();
        let needs = match drafting::needs(&text) {
            Ok(n) => n,
            Err(e) => {
                unread.push(format!("{name}: {e}"));
                continue;
            }
        };
        let m = needs
            .measurements
            .as_ref()
            .and_then(|n| tables.get(n))
            .map(|t| std::fs::read_to_string(t).unwrap());
        match drafting::read(&text, m.as_deref(), None) {
            Ok(r) => {
                made += r.shapes.len();
                refused += r.refused.len();
                println!(
                    "{:>3} made {:>2} refused  {name}",
                    r.shapes.len(),
                    r.refused.len()
                );
                for (piece, why) in &r.refused {
                    println!("        {piece}: {why}");
                }
            }
            Err(e) => unread.push(format!("{name}: {e}")),
        }
    }
    println!("{patterns} patterns: {made} pieces made, {refused} refused");
    for u in &unread {
        println!("not read: {u}");
    }
    assert!(unread.is_empty(), "{} patterns not read", unread.len());
}
