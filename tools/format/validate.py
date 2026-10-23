#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Checks a Vitryne file (a .vtry zip, or the same layout as a folder) against
docs/format/schema/ and the reference rules of docs/FORMAT.md that a schema can't express.

usage: tools/format/validate.py <file.vtry | folder> ...      (needs: pip install jsonschema)

A check of hand-written files against the JSON Schemas, independent of vitryne-format.
"""
import hashlib
import json
import pathlib
import sys
import zipfile

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SCHEMA_DIR = pathlib.Path(__file__).resolve().parents[2] / "docs" / "format" / "schema"
MEDIA = {
    "project": "application/vnd.vitryne.project+zip",
    "garment": "application/vnd.vitryne.garment+zip",
    "fabric": "application/vnd.vitryne.fabric+zip",
    "avatar": "application/vnd.vitryne.avatar+zip",
}


def load_schemas():
    schemas = {p.name.removesuffix(".schema.json"): json.loads(p.read_text()) for p in SCHEMA_DIR.glob("*.schema.json")}
    registry = Registry().with_resources(
        [(s["$id"], Resource.from_contents(s)) for s in schemas.values()]
        + [(f"{name}.schema.json", Resource.from_contents(s)) for name, s in schemas.items()]
    )
    return {name: Draft202012Validator(s, registry=registry) for name, s in schemas.items()}


class Container:
    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.zip = None if self.path.is_dir() else zipfile.ZipFile(self.path)

    def names(self):
        if self.zip:
            return [n for n in self.zip.namelist() if not n.endswith("/")]
        return [str(p.relative_to(self.path)) for p in self.path.rglob("*") if p.is_file()]

    def read(self, name):
        if self.zip:
            return self.zip.read(name)
        return (self.path / name).read_bytes()


def check(path, validators):
    errors, warnings = [], []
    c = Container(path)
    names = set(c.names())

    if c.zip:
        first = c.zip.infolist()[0]
        if first.filename != "mimetype" or first.compress_type != zipfile.ZIP_STORED:
            errors.append("the first zip entry must be 'mimetype', stored uncompressed")
    if "mimetype" not in names or "manifest.json" not in names:
        return [f"missing mimetype or manifest.json"], warnings

    manifest = json.loads(c.read("manifest.json"))
    for e in validators["manifest"].iter_errors(manifest):
        errors.append(f"manifest.json: {e.json_path}: {e.message}")
    kind = manifest.get("kind")
    if c.read("mimetype").decode() != MEDIA.get(kind):
        errors.append(f"mimetype must be {MEDIA.get(kind)!r} for kind {kind!r}")

    listed = {p["path"]: p for p in manifest.get("parts", [])}
    for name in sorted(names - set(listed) - {"mimetype", "manifest.json"}):
        warnings.append(f"{name}: in the container but not in manifest.parts")
    parts = {}
    for p, entry in listed.items():
        if p not in names:
            (warnings if entry.get("role") == "cache" else errors).append(f"{p}: listed in the manifest but missing")
            continue
        data = c.read(p)
        if "sha256" in entry and hashlib.sha256(data).hexdigest() != entry["sha256"]:
            warnings.append(f"{p}: sha256 doesn't match the manifest (edited by hand?)")
        if entry["mediaType"] == "application/json":
            parts[p] = json.loads(data)

    def entities(folder, schema, path_of):
        out = {}
        for p, obj in parts.items():
            if p.startswith(folder + "/") and (p.endswith("/avatar.json") if folder == "avatars" else True):
                for e in validators[schema].iter_errors(obj):
                    errors.append(f"{p}: {e.json_path}: {e.message}")
                if p != path_of(obj.get("id")):
                    errors.append(f"{p}: must be at {path_of(obj.get('id'))}")
                out[obj.get("id")] = obj
        return out

    garments = entities("garments", "garment", lambda i: f"garments/{i}.json")
    fabrics = entities("fabrics", "fabric", lambda i: f"fabrics/{i}.json")
    appearances = entities("appearances", "appearance", lambda i: f"appearances/{i}.json")
    avatars = entities("avatars", "avatar", lambda i: f"avatars/{i}/avatar.json")
    project = parts.get("project.json")
    if project is not None:
        for e in validators["project"].iter_errors(project):
            errors.append(f"project.json: {e.json_path}: {e.message}")
    if "view.json" in parts:
        for e in validators["view"].iter_errors(parts["view.json"]):
            errors.append(f"view.json: {e.json_path}: {e.message}")

    # What each kind must contain.
    need = {"project": project is not None, "garment": len(garments) == 1 and project is None,
            "fabric": len(fabrics) >= 1 and not garments and not avatars and not appearances and project is None,
            "avatar": len(avatars) == 1 and not garments and not appearances and project is None}
    if not need.get(kind, False):
        errors.append(f"contents don't match kind {kind!r} (FORMAT.md, File kinds)")

    # Ids are unique across the file.
    seen = {}

    def walk(obj, where):
        if isinstance(obj, dict):
            i = obj.get("id")
            if isinstance(i, str):
                if i in seen:
                    errors.append(f"duplicate id {i} ({seen[i]} and {where})")
                seen[i] = where
            for k, v in obj.items():
                if k not in ("extensions", "extras"):
                    walk(v, where)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, where)

    for p, obj in parts.items():
        if p != "manifest.json":
            walk(obj, p)

    # References.
    if project is not None:
        for g in project.get("garments", []):
            if g not in garments:
                errors.append(f"project.json: garment {g} has no part")
        for f in project.get("fabrics", []):
            if f not in fabrics:
                errors.append(f"project.json: fabric {f} has no part")
        if project.get("avatar") not in avatars:
            errors.append(f"project.json: avatar {project.get('avatar')} has no part")
        if set(fabrics) - set(project.get("fabrics", [])):
            errors.append("project.json: fabrics must list every fabric part")
        for a in project.get("appearances", []):
            if a not in appearances:
                errors.append(f"project.json: appearance {a} has no part")
        if set(appearances) - set(project.get("appearances", [])):
            errors.append("project.json: appearances must list every appearance part")
    avatar = avatars.get(project.get("avatar")) if project else None
    for a in avatars.values():
        if a.get("mesh") not in listed:
            errors.append(f"avatar {a.get('name')}: mesh {a.get('mesh')} is not a listed part")

    for gid, g in garments.items():
        where = f"garments/{gid}.json"
        if g.get("fabric") not in fabrics:
            errors.append(f"{where}: fabric {g.get('fabric')} has no part")
        if "appearance" in g and g["appearance"] not in appearances:
            errors.append(f"{where}: appearance {g['appearance']} has no part")
        cuts, piece_of_cut = {}, {}
        sources = {s["id"] for s in g.get("sources", [])}
        for s in g.get("sources", []):
            if "part" in s and s["part"] not in listed:
                warnings.append(f"{where}: source {s.get('fileName')}: part {s['part']} not in the file (left out of a shared copy?)")
        for piece in g.get("pieces", []):
            if "source" in piece and piece["source"].get("source") not in sources:
                errors.append(f"{where}: piece {piece.get('name')}: source {piece['source'].get('source')} is not in sources")
            outline = {n["id"] for n in piece.get("outline", [])}
            lines = {l["id"]: [n["id"] for n in l.get("nodes", [])] for l in piece.get("lines", [])}
            for l in piece.get("lines", []):
                ns = l.get("nodes", [])
                if ns and "edge" in ns[-1]:
                    errors.append(f"{where}: line {l.get('name')}: the last node has no edge")
                if any("edge" not in n for n in ns[:-1]):
                    errors.append(f"{where}: line {l.get('name')}: every node but the last needs an edge")
            for f in piece.get("folds", []):
                if f.get("from") not in outline or f.get("to") not in outline:
                    errors.append(f"{where}: piece {piece.get('name')}: fold ends must be outline nodes")
            for cut in piece.get("cuts", []):
                cuts[cut["id"]] = cut
                piece_of_cut[cut["id"]] = (piece, outline, lines)
                if "fabric" in cut and cut["fabric"] not in fabrics:
                    errors.append(f"{where}: cut {cut.get('name')}: fabric has no part")
                if "appearance" in cut and cut["appearance"] not in appearances:
                    errors.append(f"{where}: cut {cut.get('name')}: appearance has no part")
        for cid, cut in cuts.items():
            pl = cut.get("placement", {})
            if pl.get("type") == "wrap" and avatar is not None and pl.get("region") not in avatar.get("regions", {}):
                errors.append(f"{where}: cut {cut.get('name')}: the avatar has no region {pl.get('region')!r}")
            if pl.get("type") == "follow":
                seen_chain, k = {cid}, pl.get("cut")
                while k is not None:
                    if k not in cuts:
                        errors.append(f"{where}: cut {cut.get('name')}: follows unknown cut {k}")
                        break
                    if k in seen_chain:
                        errors.append(f"{where}: cut {cut.get('name')}: placement follows itself")
                        break
                    seen_chain.add(k)
                    nxt = cuts[k].get("placement", {})
                    k = nxt.get("cut") if nxt.get("type") == "follow" else None
        for s in g.get("seams", []):
            for side in ("a", "b"):
                for r in s.get(side, []):
                    if r.get("cut") not in piece_of_cut:
                        errors.append(f"{where}: seam {s.get('name')}: unknown cut {r.get('cut')}")
                        continue
                    piece, outline, lines = piece_of_cut[r["cut"]]
                    nodes = set(lines.get(r["line"], [])) if "line" in r else outline
                    if "line" in r and r["line"] not in lines:
                        errors.append(f"{where}: seam {s.get('name')}: no line {r['line']} on piece {piece.get('name')}")
                    if r.get("from") not in nodes or r.get("to") not in nodes:
                        errors.append(f"{where}: seam {s.get('name')}: run ends must be nodes of piece {piece.get('name')}'s {'line' if 'line' in r else 'outline'}")
                    if r.get("from") == r.get("to"):
                        errors.append(f"{where}: seam {s.get('name')}: a run needs two different nodes")

    used = set(manifest.get("extensionsUsed", []))
    for name in manifest.get("extensionsRequired", []):
        if name not in used:
            errors.append(f"manifest.json: required extension {name} is not in extensionsUsed")
    return errors, warnings


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    validators = load_schemas()
    bad = False
    for path in sys.argv[1:]:
        errors, warnings = check(path, validators)
        for w in warnings:
            print(f"{path}: warning: {w}")
        for e in errors:
            print(f"{path}: error: {e}")
        print(f"{path}: {'FAILED' if errors else 'ok'}")
        bad |= bool(errors)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
