//! wasm entry point. Same drape-core, WebGPU backend only (no WebGL fallback).

use drape_core::gpu;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Renders the M0 triangle into `<canvas id=canvas_id>`. wasm-only (canvas surface); the rest
/// of the crate also builds natively so `cargo test --workspace` and rust-analyzer check it.
/// Returns `{ "adapter": AdapterReport, "gpu_pass_times": [...] }` as JSON.
/// `gpu_timestamps` turns on the opt-in profiling mode (see `GpuOptions`).
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn start(canvas_id: String, gpu_timestamps: bool) -> Result<String, JsValue> {
    use drape_core::{timer::GpuTimer, triangle::TriangleRenderer};
    let canvas: web_sys::HtmlCanvasElement = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(&canvas_id))
        .ok_or("canvas not found")?
        .dyn_into()
        .map_err(|_| "element is not a canvas")?;
    let (width, height) = (canvas.width().max(1), canvas.height().max(1));

    let instance = gpu::create_instance();
    let surface = instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        .map_err(|e| format!("create_surface: {e}"))?;
    let g = gpu::Gpu::new(&instance, Some(&surface), gpu::GpuOptions { gpu_timestamps }).await?;
    if g.report.backend != "BrowserWebGpu" {
        return Err(format!("expected BrowserWebGpu backend, got {}", g.report.backend).into());
    }

    let config = surface
        .get_default_config(&g.adapter, width, height)
        .ok_or("surface unsupported by adapter")?;
    surface.configure(&g.device, &config);
    let renderer = TriangleRenderer::new(&g.device, config.format);
    let mut timer = GpuTimer::new(&g.device, &g.queue, 1);

    let frame = match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
        _ => return Err("get_current_texture failed".into()),
    };
    let view = frame.texture.create_view(&Default::default());
    let mut enc = g.device.create_command_encoder(&Default::default());
    timer.begin_frame();
    renderer.draw(&mut enc, &view, timer.render_pass_writes("triangle"));
    timer.resolve(&mut enc);
    g.queue.submit([enc.finish()]);
    g.queue.present(frame);
    let gpu_pass_times = timer.read(&g.device).await;

    let out = serde_json::json!({ "adapter": g.report, "gpu_pass_times": gpu_pass_times });
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}

/// Runs the same headless benchmark as `drape bench` (drape_core::bench::run) and returns its
/// JSON. A fresh device per run, since `gpu_timestamps` changes the requested features.
#[wasm_bindgen]
pub async fn run_bench(grid: u32, substeps: u32, frames: u32, gpu_timestamps: bool) -> Result<String, JsValue> {
    let instance = gpu::create_instance();
    let g = gpu::Gpu::new(&instance, None, gpu::GpuOptions { gpu_timestamps }).await?;
    let scene = drape_core::scene::SheetScene { grid, ..Default::default() };
    let mut sim = drape_core::scene::SheetScene::config();
    sim.substeps = substeps;
    let built = scene.build(sim);
    let cfg = drape_core::bench::BenchConfig { frames, ..Default::default() };
    let r = drape_core::bench::run(&g, &built, cfg).await;
    g.device.destroy();
    serde_json::to_string(&r).map_err(|e| e.to_string().into())
}
