//! wasm entry point. Same drape-core, WebGPU backend only (no WebGL fallback).

use drape_core::{gpu, triangle::TriangleRenderer};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Renders the M0 triangle into `<canvas id=canvas_id>`. Returns the adapter report as JSON.
#[wasm_bindgen]
pub async fn start(canvas_id: String) -> Result<String, JsValue> {
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
    let g = gpu::Gpu::new(&instance, Some(&surface)).await?;
    if g.report.backend != "BrowserWebGpu" {
        return Err(format!("expected BrowserWebGpu backend, got {}", g.report.backend).into());
    }

    let config = surface
        .get_default_config(&g.adapter, width, height)
        .ok_or("surface unsupported by adapter")?;
    surface.configure(&g.device, &config);
    let renderer = TriangleRenderer::new(&g.device, config.format);

    let frame = match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
        _ => return Err("get_current_texture failed".into()),
    };
    let view = frame.texture.create_view(&Default::default());
    let mut enc = g.device.create_command_encoder(&Default::default());
    renderer.draw(&mut enc, &view);
    g.queue.submit([enc.finish()]);
    g.queue.present(frame);

    Ok(serde_json::to_string_pretty(&g.report).unwrap_or_default())
}
