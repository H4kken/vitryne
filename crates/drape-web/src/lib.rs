//! wasm entry points. The same drape-core and drape-assets as native; WebGPU backend only (no
//! WebGL fallback). Builds natively too (only the canvas viewer is wasm-only), so
//! `cargo test --workspace` and rust-analyzer check it.

use std::sync::Arc;

use drape_assets::{
    garment::Garment,
    tshirt::{self, SdfParams, TshirtParams},
};
use drape_core::{
    body::{BodyMesh, BodyQuery, Sdf},
    gpu,
    scene::{Built, SheetScene},
};
use wasm_bindgen::prelude::*;
use web_time::Instant;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Scene options as JSON, all optional: `{"self_collision": bool, "self_rebuild": u32,
/// "pins": bool, "contact_max_accel": f32, "untangle_every": u32, "untangle_step": f32}` (the
/// same switches as the native `--self-collision`, `--self-rebuild`, `--no-pins`,
/// `--contact-max-accel`, `--untangle-every`, `--untangle-step`). The garment scene also takes
/// `"garment_toml"` and `"garment_dxf"` (file contents).
fn parse_opts(opts: &str) -> Result<serde_json::Value, JsValue> {
    if opts.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(opts).map_err(|e| format!("options: {e}").into())
}

/// Scene by name. `res`: sheet = vertices per side, tshirt = target edge length (m),
/// garment = target vertex count. The T-shirt and garments need the body OBJ; the SDF is baked
/// here when `sdf` is empty (garment: its own box from the toml).
fn build_scene(scene: &str, res: f32, substeps: u32, opts: &str, obj: &str, sdf: &[u8]) -> Result<(Built, serde_json::Value), JsValue> {
    let o = parse_opts(opts)?;
    let mut sim = SheetScene::config();
    if substeps > 0 {
        sim.substeps = substeps;
    }
    sim.self_collision = o["self_collision"].as_bool().unwrap_or(false);
    if let Some(k) = o["self_rebuild"].as_u64() {
        sim.self_rebuild_every = k as u32;
    }
    if let Some(a) = o["contact_max_accel"].as_f64() {
        sim.contact_max_accel = a as f32;
    }
    if let Some(k) = o["untangle_every"].as_u64() {
        sim.untangle_every = k as u32;
    }
    if let Some(a) = o["untangle_step"].as_f64() {
        sim.untangle_step_edges = a as f32;
    }
    match scene {
        "sheet" => {
            let pins = o["pins"].as_bool().unwrap_or(true);
            Ok((SheetScene { grid: res as u32, pins, ..Default::default() }.build(sim), serde_json::json!({})))
        }
        "tshirt" => {
            let t0 = Instant::now();
            let body = Arc::new(BodyQuery::new(BodyMesh::from_obj(obj).map_err(|e| format!("body obj: {e}"))?));
            let bvh_ms = t0.elapsed().as_secs_f64() * 1000.0;
            let t1 = Instant::now();
            let (sdf, source) = if sdf.is_empty() {
                (SdfParams::default().bake(&body), "baked in wasm")
            } else {
                (Sdf::from_bytes(sdf).ok_or("bad SDF file")?, "fetched")
            };
            let sdf_ms = t1.elapsed().as_secs_f64() * 1000.0;
            let load = serde_json::json!({ "bvh_ms": bvh_ms, "sdf_ms": sdf_ms, "sdf_source": source, "sdf_bytes": sdf.bytes() });
            log::info!("tshirt assets: {load}");
            let params = TshirtParams { edge: res, ..Default::default() };
            Ok((tshirt::build(&params, body, Arc::new(sdf), sim), load))
        }
        "garment" => {
            let g = Garment::load(o["garment_toml"].as_str().unwrap_or(""), o["garment_dxf"].as_str().unwrap_or("")).map_err(|e| format!("garment: {e}"))?;
            let edge = g.edge_for_vertices(res as u32).map_err(|e| format!("garment: {e}"))?;
            let body = Arc::new(BodyQuery::new(BodyMesh::from_obj(obj).map_err(|e| format!("body obj: {e}"))?));
            let sdf = if sdf.is_empty() { g.sdf_params().bake(&body) } else { Sdf::from_bytes(sdf).ok_or("bad SDF file")? };
            let built = g.build(edge, body, Arc::new(sdf), sim).map_err(|e| format!("garment: {e}"))?;
            Ok((built, serde_json::json!({})))
        }
        other => Err(format!("unknown scene {other}").into()),
    }
}

async fn headless_gpu(gpu_timestamps: bool) -> Result<gpu::Gpu, JsValue> {
    let instance = gpu::create_instance();
    Ok(gpu::Gpu::new(&instance, None, gpu::GpuOptions { gpu_timestamps }).await?)
}

/// The same headless benchmark as `drape bench` (drape_core::bench::run), as JSON. A fresh
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
    let g = headless_gpu(gpu_timestamps).await?;
    let (built, load) = build_scene(&scene, res, substeps, &opts, &obj, &sdf)?;
    let cfg = drape_core::bench::BenchConfig { frames, record_positions, ..Default::default() };
    let r = drape_core::bench::run(&g, &built, cfg).await;
    g.device.destroy();
    let mut v = serde_json::to_value(&r).map_err(|e| e.to_string())?;
    v["asset_load"] = load;
    Ok(v.to_string())
}

/// The same random-drag stability test as `drape bench-drag`, as JSON (scene: tshirt | garment).
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
    let g = headless_gpu(false).await?;
    let (built, _) = build_scene(&scene, res, 0, &opts, &obj, &sdf)?;
    let cfg = drape_core::dragbench::DragBenchConfig { seed: seed as u64, drag_s, max_offset, min_pull_s, ..Default::default() };
    let r = drape_core::dragbench::run(&g, &built, cfg).await;
    g.device.destroy();
    serde_json::to_string(&r).map_err(|e| e.to_string().into())
}

/// Bake the T-shirt SDF in wasm (single-threaded) and return how long it took, in ms.
#[wasm_bindgen]
pub fn bake_sdf_ms(obj: String) -> Result<f64, JsValue> {
    let body = BodyQuery::new(BodyMesh::from_obj(&obj).map_err(|e| format!("body obj: {e}"))?);
    let t0 = Instant::now();
    let sdf = SdfParams::default().bake(&body);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    log::info!("wasm SDF bake: {}x{}x{} in {ms:.0} ms", sdf.dims.x, sdf.dims.y, sdf.dims.z);
    Ok(ms)
}

#[cfg(target_arch = "wasm32")]
mod viewer;
#[cfg(target_arch = "wasm32")]
pub use viewer::App;
