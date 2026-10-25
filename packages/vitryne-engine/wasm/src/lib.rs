// SPDX-License-Identifier: AGPL-3.0-or-later
//! wasm entry points. The same vitryne-solver and vitryne-pattern as native; WebGPU backend only (no
//! WebGL fallback). Builds natively too (only the viewport is wasm-only), so
//! `cargo test --workspace` and rust-analyzer check it.
//!
//! The editor's worker uses `VtryFile` (open, validate, save: no GPU, so the app's tests run it
//! in Node too), `PreparedScene` and `Viewport` (the drape on an OffscreenCanvas). The bench
//! page uses `run_bench`, `run_drag_bench` and `bake_sdf_ms`.

use std::{collections::BTreeMap, sync::Arc};

use vitryne_pattern::{
    garment::Garment as DxfGarment,
    import::{Choice, ImportSource},
    placement::BodyPlace,
    seams::EdgePick,
    tshirt::{self, SdfParams, TshirtParams},
};
use vitryne_solver::{
    body::{BodyMesh, BodyQuery},
    engine::{Avatar, Body, BodyOptions, Engine, Garment, SdfSource},
    gpu,
    scene::SheetScene,
    sim::SimSettings,
};
use wasm_bindgen::prelude::*;
use web_time::Instant;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Scene options as JSON, all optional: `{"self_collision": bool, "self_rebuild": u32,
/// "pins": bool, "contact_max_accel": f32, "untangle_every": u32, "untangle_check_every": u32,
/// "untangle_step": f32}` (the same switches as the native `--self-collision`, `--self-rebuild`,
/// `--no-pins`, `--contact-max-accel`, `--untangle-every`, `--untangle-check-every`,
/// `--untangle-step`). The garment scene also takes
/// `"garment_toml"` and `"garment_dxf"` (file contents).
fn parse_opts(opts: &str) -> Result<serde_json::Value, JsValue> {
    if opts.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(opts).map_err(|e| format!("options: {e}").into())
}

/// A scene ready to simulate, and what loading it cost.
struct Scene {
    garment: Arc<Garment>,
    body: Arc<Body>,
    settings: SimSettings,
    load: serde_json::Value,
}

/// Scene by name. `res`: sheet = vertices per side, tshirt = target edge length (m),
/// garment = target vertex count. The T-shirt and garments need the body OBJ; the SDF is baked
/// here when `sdf` is empty (garment: its own box from the toml).
fn build_scene(
    scene: &str,
    res: f32,
    substeps: u32,
    opts: &str,
    obj: &str,
    sdf: &[u8],
) -> Result<Scene, JsValue> {
    let o = parse_opts(opts)?;
    let mut settings = SheetScene::config();
    if substeps > 0 {
        settings.substeps = substeps;
    }
    settings.self_collision = o["self_collision"].as_bool().unwrap_or(false);
    if let Some(k) = o["self_rebuild"].as_u64() {
        settings.self_rebuild_every = k as u32;
    }
    if let Some(a) = o["contact_max_accel"].as_f64() {
        settings.contact_max_accel = a as f32;
    }
    if let Some(k) = o["untangle_every"].as_u64() {
        settings.untangle_every = k as u32;
    }
    if let Some(k) = o["untangle_check_every"].as_u64() {
        settings.untangle_check_every = k as u32;
    }
    if let Some(a) = o["untangle_step"].as_f64() {
        settings.untangle_step_edges = a as f32;
    }
    let avatar_body = |params: SdfParams| -> Result<(Body, serde_json::Value), JsValue> {
        let t0 = Instant::now();
        let source = if sdf.is_empty() {
            SdfSource::Bake(params)
        } else {
            SdfSource::Bytes(sdf.to_vec())
        };
        let body = Body::load(
            &Avatar {
                name: "avatar".into(),
                obj: obj.to_string(),
            },
            &BodyOptions { sdf: source },
        )?;
        let load = serde_json::json!({
            "body_sdf_ms": t0.elapsed().as_secs_f64() * 1000.0,
            "sdf_source": if sdf.is_empty() { "baked in wasm" } else { "fetched" },
            "sdf_bytes": body.sdf().map_or(0, |s| s.bytes()),
        });
        log::info!("assets: {load}");
        Ok((body, load))
    };
    let (desc, fabric, body, load) = match scene {
        "sheet" => {
            let sheet = SheetScene {
                grid: res as u32,
                pins: o["pins"].as_bool().unwrap_or(true),
                ..Default::default()
            };
            let (c, r) = sheet.sphere();
            (
                sheet.garment(),
                sheet.fabric(),
                Body::sphere(c, r),
                serde_json::json!({}),
            )
        }
        "tshirt" => {
            let params = TshirtParams {
                edge: res,
                ..Default::default()
            };
            let (body, load) = avatar_body(SdfParams::default())?;
            (tshirt::build(&params), tshirt::fabric(), body, load)
        }
        "garment" => {
            let g = DxfGarment::load(
                o["garment_toml"].as_str().unwrap_or(""),
                o["garment_dxf"].as_str().unwrap_or(""),
            )
            .map_err(|e| format!("garment: {e}"))?;
            let edge = g
                .edge_for_vertices(res as u32)
                .map_err(|e| format!("garment: {e}"))?;
            let (body, load) = avatar_body(g.sdf_params())?;
            let desc = g.build(edge).map_err(|e| format!("garment: {e}"))?;
            (desc, g.fabric(), body, load)
        }
        other => return Err(format!("unknown scene {other}").into()),
    };
    Ok(Scene {
        garment: Arc::new(Garment::load(&desc, &fabric)?),
        body: Arc::new(body),
        settings,
        load,
    })
}

async fn headless_gpu(gpu_timestamps: bool) -> Result<gpu::Gpu, JsValue> {
    let instance = gpu::create_instance();
    Ok(gpu::Gpu::new(&instance, None, gpu::GpuOptions { gpu_timestamps }).await?)
}

/// The same headless benchmark as `vitryne bench` (vitryne_solver::bench::run), as JSON. A fresh
/// device per run, since `gpu_timestamps` changes the requested features.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub async fn run_bench(
    scene: String,
    res: f32,
    substeps: u32,
    frames: u32,
    gpu_timestamps: bool,
    record_positions: bool,
    opts: String,
    obj: String,
    sdf: Vec<u8>,
) -> Result<String, JsValue> {
    let engine = Engine::new(headless_gpu(gpu_timestamps).await?);
    let sc = build_scene(&scene, res, substeps, &opts, &obj, &sdf)?;
    let sim = engine.simulate(&sc.garment, &sc.body, &sc.settings);
    let cfg = vitryne_solver::bench::BenchConfig {
        frames,
        record_positions,
        ..Default::default()
    };
    let r = vitryne_solver::bench::run(&sim, cfg).await;
    engine.gpu().device.destroy();
    let mut v = serde_json::to_value(&r).map_err(|e| e.to_string())?;
    v["asset_load"] = sc.load;
    Ok(v.to_string())
}

/// The same random-drag stability test as `vitryne bench-drag`, as JSON (scene: tshirt | garment).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub async fn run_drag_bench(
    scene: String,
    res: f32,
    seed: u32,
    drag_s: f32,
    max_offset: f32,
    min_pull_s: f32,
    opts: String,
    obj: String,
    sdf: Vec<u8>,
) -> Result<String, JsValue> {
    let engine = Engine::new(headless_gpu(false).await?);
    let sc = build_scene(&scene, res, 0, &opts, &obj, &sdf)?;
    let sim = engine.simulate(&sc.garment, &sc.body, &sc.settings);
    let cfg = vitryne_solver::dragbench::DragBenchConfig {
        seed: seed as u64,
        drag_s,
        max_offset,
        min_pull_s,
        ..Default::default()
    };
    let r = vitryne_solver::dragbench::run(&sim, cfg).await;
    engine.gpu().device.destroy();
    serde_json::to_string(&r).map_err(|e| e.to_string().into())
}

/// Bake the T-shirt SDF in wasm (single-threaded) and return how long it took, in ms.
#[wasm_bindgen]
pub fn bake_sdf_ms(obj: String) -> Result<f64, JsValue> {
    let body = BodyQuery::new(BodyMesh::from_obj(&obj).map_err(|e| format!("body obj: {e}"))?);
    let t0 = Instant::now();
    let sdf = SdfParams::default().bake(&body);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    log::info!(
        "wasm SDF bake: {}x{}x{} in {ms:.0} ms",
        sdf.dims.x,
        sdf.dims.y,
        sdf.dims.z
    );
    Ok(ms)
}

/// A `.vtry` project in the worker (`project::ProjectFile`). Errors are strings for the UI.
#[wasm_bindgen]
pub struct VtryFile {
    file: project::ProjectFile,
    warnings: Vec<String>,
}

fn read_source(json: &str) -> Result<ImportSource, String> {
    serde_json::from_str(json).map_err(|e| format!("import source: {e}"))
}

#[wasm_bindgen]
impl VtryFile {
    /// Opens a `.vtry` zip; refuses anything that isn't a valid project.
    pub fn open(bytes: &[u8]) -> Result<VtryFile, JsValue> {
        let (file, report) = project::ProjectFile::open(bytes)?;
        Ok(VtryFile {
            file,
            warnings: report.warnings,
        })
    }

    /// Opens the folder form: `paths[i]` (relative, `/`-separated) holds `contents[i]`
    /// (`Uint8Array`s).
    pub fn open_folder(paths: Vec<String>, contents: js_sys::Array) -> Result<VtryFile, JsValue> {
        if paths.len() != contents.length() as usize {
            return Err("open_folder: one content per path".into());
        }
        let files = paths
            .into_iter()
            .zip(contents.iter())
            .map(|(p, c)| (p, js_sys::Uint8Array::new(&c).to_vec()))
            .collect();
        let (file, report) = project::ProjectFile::open_folder(files)?;
        Ok(VtryFile {
            file,
            warnings: report.warnings,
        })
    }

    /// The folder form's files, checked: an array of `[path, Uint8Array]`.
    pub fn save_folder(&self) -> Result<js_sys::Array, JsValue> {
        let out = js_sys::Array::new();
        for (path, bytes) in self.file.save_folder()? {
            let pair = js_sys::Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&js_sys::Uint8Array::from(bytes.as_slice()));
            out.push(&pair);
        }
        Ok(out)
    }

    /// What opening noticed without refusing the file (JSON array of strings).
    pub fn warnings(&self) -> String {
        serde_json::to_string(&self.warnings).expect("strings serialize")
    }

    /// The entities as JSON text (`vitryne_format::Entities`).
    pub fn entities(&self) -> String {
        self.file.entities_json()
    }

    /// Replaces the entities if they are valid, else changes nothing and throws why. Returns the
    /// warnings (JSON array).
    pub fn set_entities(&mut self, json: &str) -> Result<String, JsValue> {
        let w = self.file.set_entities_json(json)?;
        Ok(serde_json::to_string(&w).expect("strings serialize"))
    }

    /// The `.vtry` bytes, already read back and checked.
    pub fn save(&self) -> Result<Vec<u8>, JsValue> {
        Ok(self.file.save()?)
    }

    /// Meshes and places the garment for `Viewport::load` (CPU, tens of ms).
    pub fn prepare(&self) -> Result<PreparedScene, JsValue> {
        Ok(PreparedScene {
            inner: self.file.prepare()?,
        })
    }

    /// What a pattern file needs before it can be read (`valentina::Needs` as JSON): the
    /// measurements file a Valentina pattern was drafted with, if any.
    pub fn pattern_needs(text: &str) -> Result<String, JsValue> {
        let n = vitryne_pattern::valentina::needs(text)?;
        Ok(serde_json::to_string(&n).expect("needs serialize"))
    }

    /// What importing a pattern would give (`import::Preview` as JSON): its pieces, what was
    /// ignored, a suggested place for each. `source`: `import::ImportSource` as JSON.
    pub fn inspect_import(source: &str) -> Result<String, JsValue> {
        let imp = read_source(source)?.read()?;
        Ok(serde_json::to_string(&imp.preview()).expect("preview serializes"))
    }

    /// A new project from a pattern (`source`: `import::ImportSource` as JSON), its pieces
    /// placed as `choices` (JSON: piece name -> `import::Choice`) say. `body_glb`: the test
    /// avatar's mesh. `seed`: random bytes for the ids. The import's notes are in `warnings()`.
    pub fn import_new(
        source: &str,
        choices: &str,
        body_glb: &[u8],
        now_ms: f64,
        seed: &[u8],
    ) -> Result<VtryFile, JsValue> {
        let choices: BTreeMap<String, Choice> =
            serde_json::from_str(choices).map_err(|e| format!("choices: {e}"))?;
        let imported = project::ProjectFile::import_new(
            &read_source(source)?,
            &choices,
            body_glb,
            now_ms as u64,
            seed,
        )?;
        Ok(VtryFile {
            file: imported.file,
            warnings: imported.notes,
        })
    }

    /// A project started from scratch, with a garment with no pieces yet. `body_glb`: the test
    /// avatar's mesh. `seed`: random bytes for the ids.
    pub fn new_empty(body_glb: &[u8], now_ms: f64, seed: &[u8]) -> Result<VtryFile, JsValue> {
        Ok(VtryFile {
            file: project::ProjectFile::new_empty(body_glb, now_ms as u64, seed)?,
            warnings: Vec::new(),
        })
    }

    /// Pieces from a pattern (`source`: `import::ImportSource` as JSON) to add to this
    /// project's garment (`import::Addition` as JSON). The project is unchanged: the editor
    /// adds them as an edit.
    pub fn import_addition(
        &self,
        source: &str,
        choices: &str,
        now_ms: f64,
        seed: &[u8],
    ) -> Result<String, JsValue> {
        let choices: BTreeMap<String, Choice> =
            serde_json::from_str(choices).map_err(|e| format!("choices: {e}"))?;
        let a = self
            .file
            .import_addition(&read_source(source)?, &choices, now_ms as u64, seed)?;
        Ok(serde_json::to_string(&a).expect("addition serializes"))
    }

    /// Every whole edge of every cut, free or sewn (`seams::CutEdge[]` as JSON).
    pub fn sewing_edges(&self) -> Result<String, JsValue> {
        let r = self.file.sewing_edges()?;
        Ok(serde_json::to_string(&r).expect("edges serialize"))
    }

    /// Suggested seams for the edges nothing sews yet (`seams::SeamProposal[]` as JSON). The
    /// project is unchanged; the editor adds an accepted one as a command.
    pub fn suggest_seams(&self) -> Result<String, JsValue> {
        let r = self.file.suggest_seams()?;
        Ok(serde_json::to_string(&r).expect("proposals serialize"))
    }

    /// The seam whole edges make: `a` and `b` are each one `{cut, from, to}` or an array of
    /// them (a chain, in the order picked), as JSON. Anything that isn't a whole edge is
    /// refused.
    pub fn join_edges(&self, a: &str, b: &str) -> Result<String, JsValue> {
        let side = |name: &str, json: &str| -> Result<Vec<EdgePick>, String> {
            let v: serde_json::Value =
                serde_json::from_str(json).map_err(|e| format!("edge {name}: {e}"))?;
            let list = if v.is_array() {
                v
            } else {
                serde_json::json!([v])
            };
            serde_json::from_value(list).map_err(|e| format!("edge {name}: {e}"))
        };
        let r = self.file.join_edges(&side("a", a)?, &side("b", b)?)?;
        Ok(serde_json::to_string(&r).expect("proposal serializes"))
    }

    /// Each seam's length difference, percent, by seam id (JSON object).
    pub fn seam_differences(&self) -> Result<String, JsValue> {
        let r = self.file.seam_differences()?;
        Ok(serde_json::to_string(&r).expect("differences serialize"))
    }

    /// Cut `cut` (its id) started again at `place` (a `placement::BodyPlace` name, e.g.
    /// "body-front"): `project::Rewrapped` as JSON. The project is unchanged.
    pub fn rewrap(&self, cut: &str, place: &str) -> Result<String, JsValue> {
        let place: BodyPlace = serde_json::from_value(serde_json::Value::String(place.into()))
            .map_err(|_| format!("no place {place:?}"))?;
        let r = self.file.rewrap(cut, place)?;
        Ok(serde_json::to_string(&r).expect("rewrap serializes"))
    }

    /// A new piece (`piece`: its JSON, cuts included) wrapped around the body, cut `k` at
    /// `places[k]` (a JSON array of `placement::BodyPlace` names): `project::PlacedPiece` as
    /// JSON. The project is unchanged.
    pub fn place_piece(&self, piece: &str, places: &str) -> Result<String, JsValue> {
        let piece: vitryne_format::Piece =
            serde_json::from_str(piece).map_err(|e| format!("the piece: {e}"))?;
        let places: Vec<BodyPlace> =
            serde_json::from_str(places).map_err(|e| format!("the places: {e}"))?;
        let r = self.file.place_piece(&piece, &places)?;
        Ok(serde_json::to_string(&r).expect("placed piece serializes"))
    }
}

/// A garment meshed and placed, waiting for its body (see `PreparedInfo`).
#[wasm_bindgen]
pub struct PreparedScene {
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    inner: project::Prepared,
}

#[wasm_bindgen]
impl PreparedScene {
    /// `project::PreparedInfo` as JSON: the SDF key, vertices, warnings.
    pub fn info(&self) -> String {
        serde_json::to_string(&self.inner.info).expect("info serializes")
    }
}

pub mod project;
#[cfg(target_arch = "wasm32")]
mod viewport;
#[cfg(target_arch = "wasm32")]
pub use viewport::Viewport;
