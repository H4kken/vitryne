// SPDX-License-Identifier: AGPL-3.0-or-later
//! Canvas viewer: the same Solver + Renderer as the native viewer, driven by requestAnimationFrame
//! from JS. Picking reads positions back once per pointer-down (not per frame).

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use drape_core::{
    gpu,
    render::{self, OrbitCamera, Renderer},
    scene::Built,
    sim::{DRAG_RADIUS, DragPatch, Solver},
};
use glam::Vec3;
use wasm_bindgen::prelude::*;
use web_time::Instant;

struct Core {
    gpu: gpu::Gpu,
    surface: wgpu::Surface<'static>,
    config: RefCell<wgpu::SurfaceConfiguration>,
    solver: Solver,
    renderer: RefCell<Renderer>,
    camera: RefCell<OrbitCamera>,
    adj: Vec<Vec<u32>>,
    pulling: Cell<Option<Vec3>>,
    sim_frame: Cell<u32>,
    fast: Cell<bool>,
    paused: Cell<bool>,
    n_verts: u32,
    /// Offscreen target for `measure_frame` (same size/format as the canvas, never presented).
    offscreen: RefCell<Option<(wgpu::TextureView, u32, u32)>>,
}

#[wasm_bindgen]
pub struct App {
    core: Rc<Core>,
    load: String,
}

#[wasm_bindgen]
impl App {
    /// Build the scene and the GPU state on `<canvas id=canvas_id>`.
    pub async fn create(
        canvas_id: String,
        scene: String,
        res: f32,
        opts: String,
        obj: String,
        sdf: Vec<u8>,
    ) -> Result<App, JsValue> {
        let canvas: web_sys::HtmlCanvasElement = web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.get_element_by_id(&canvas_id))
            .ok_or("canvas not found")?
            .dyn_into()
            .map_err(|_| "element is not a canvas")?;
        let (w, h) = (canvas.width().max(1), canvas.height().max(1));
        let instance = gpu::create_instance();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| format!("create_surface: {e}"))?;
        let g = gpu::Gpu::new(&instance, Some(&surface), gpu::GpuOptions::default()).await?;
        if g.report.backend != "BrowserWebGpu" {
            return Err(format!("expected BrowserWebGpu backend, got {}", g.report.backend).into());
        }
        let config = surface
            .get_default_config(&g.adapter, w, h)
            .ok_or("surface unsupported by adapter")?;
        surface.configure(&g.device, &config);
        let (built, load): (Built, serde_json::Value) =
            super::build_scene(&scene, res, 0, &opts, &obj, &sdf)?;
        let solver = Solver::new(
            &g.device,
            &built.mesh,
            &built.constraints,
            built.material.density,
            built.sim,
            built.collider.clone(),
        );
        let renderer = Renderer::new(
            &g.device,
            config.format,
            &built.mesh,
            &solver,
            &built.collider_mesh,
        );
        let core = Core {
            n_verts: built.mesh.n_verts() as u32,
            adj: built.mesh.neighbors(),
            camera: RefCell::new(OrbitCamera::looking_at(built.camera.0, built.camera.1)),
            gpu: g,
            surface,
            config: RefCell::new(config),
            solver,
            renderer: RefCell::new(renderer),
            pulling: Cell::new(None),
            sim_frame: Cell::new(0),
            fast: Cell::new(false),
            paused: Cell::new(false),
            offscreen: RefCell::new(None),
        };
        Ok(App {
            core: Rc::new(core),
            load: load.to_string(),
        })
    }

    /// One display frame: 1 sim frame (8 in fast-drape mode) + render + present.
    pub fn frame(&self) {
        let c = &self.core;
        let Some(frame) = (match c.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => Some(f),
            _ => None,
        }) else {
            c.surface.configure(&c.gpu.device, &c.config.borrow());
            return;
        };
        if !c.paused.get() {
            // Params are written per sim frame, and queue writes apply at submit, so each extra
            // sim frame gets its own submit.
            for _ in 0..if c.fast.get() { 7 } else { 0 } {
                c.solver.prepare_frame(&c.gpu.queue, c.sim_frame.get());
                let mut e = c.gpu.device.create_command_encoder(&Default::default());
                c.solver.encode_frame(&mut e, None);
                c.gpu.queue.submit([e.finish()]);
                c.sim_frame.set(c.sim_frame.get() + 1);
            }
        }
        let mut enc = c.gpu.device.create_command_encoder(&Default::default());
        if !c.paused.get() {
            c.solver.prepare_frame(&c.gpu.queue, c.sim_frame.get());
            c.solver.encode_frame(&mut enc, None);
            c.sim_frame.set(c.sim_frame.get() + 1);
        }
        let view = frame.texture.create_view(&Default::default());
        let cfg = c.config.borrow();
        c.renderer.borrow_mut().draw(
            &c.gpu.device,
            &c.gpu.queue,
            &mut enc,
            &view,
            cfg.width,
            cfg.height,
            &c.camera.borrow(),
        );
        c.gpu.queue.submit([enc.finish()]);
        c.gpu.queue.present(frame);
    }

    /// Cost of one display frame's work (1 sim frame + render), submit -> GPU done, in ms,
    /// rendered offscreen so it doesn't wait for the compositor. Advances the sim by one frame.
    /// Sampled (about once a second), not per frame.
    pub fn measure_frame(&self) -> js_sys::Promise {
        let c = self.core.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let (w, h, format) = {
                let cfg = c.config.borrow();
                (cfg.width, cfg.height, cfg.format)
            };
            let view = {
                let mut off = c.offscreen.borrow_mut();
                if !matches!(&*off, Some((_, ow, oh)) if *ow == w && *oh == h) {
                    let tex = c.gpu.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("measure-offscreen"),
                        size: wgpu::Extent3d {
                            width: w,
                            height: h,
                            depth_or_array_layers: 1,
                        },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format,
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        view_formats: &[],
                    });
                    *off = Some((tex.create_view(&Default::default()), w, h));
                }
                off.as_ref().unwrap().0.clone()
            };
            drape_core::gpu_async::work_done(&c.gpu.device, &c.gpu.queue).await;
            let t0 = Instant::now();
            let mut enc = c.gpu.device.create_command_encoder(&Default::default());
            if !c.paused.get() {
                c.solver.prepare_frame(&c.gpu.queue, c.sim_frame.get());
                c.solver.encode_frame(&mut enc, None);
                c.sim_frame.set(c.sim_frame.get() + 1);
            }
            c.renderer.borrow_mut().draw(
                &c.gpu.device,
                &c.gpu.queue,
                &mut enc,
                &view,
                w,
                h,
                &c.camera.borrow(),
            );
            c.gpu.queue.submit([enc.finish()]);
            drape_core::gpu_async::work_done(&c.gpu.device, &c.gpu.queue).await;
            Ok(JsValue::from_f64(t0.elapsed().as_secs_f64() * 1000.0))
        })
    }

    pub fn resize(&self, w: u32, h: u32) {
        let mut cfg = self.core.config.borrow_mut();
        cfg.width = w.max(1);
        cfg.height = h.max(1);
        self.core.surface.configure(&self.core.gpu.device, &cfg);
    }

    fn ray(&self, x: f32, y: f32) -> (Vec3, Vec3) {
        let cfg = self.core.config.borrow();
        self.core
            .camera
            .borrow()
            .ray(x, y, cfg.width as f32 / cfg.height.max(1) as f32)
    }

    /// Pointer down at normalized device coordinates. Resolves to true if cloth was grabbed
    /// (then moves drag it), false if not (then the caller orbits).
    pub fn pointer_down(&self, x: f32, y: f32) -> js_sys::Promise {
        let c = self.core.clone();
        let (o, d) = self.ray(x, y);
        wasm_bindgen_futures::future_to_promise(async move {
            let pos = c.solver.read_positions(&c.gpu.device, &c.gpu.queue).await;
            let Some(v) = render::pick(&pos, o, d, 0.015) else {
                return Ok(JsValue::FALSE);
            };
            let patch = DragPatch::grab(&c.adj, &pos, v, DRAG_RADIUS);
            c.solver.begin_drag(&c.gpu.queue, &patch);
            c.solver.set_drag_target(pos[v as usize]);
            c.pulling.set(Some(pos[v as usize]));
            Ok(JsValue::TRUE)
        })
    }

    pub fn pointer_move(&self, x: f32, y: f32) {
        if let Some(anchor) = self.core.pulling.get() {
            let (o, d) = self.ray(x, y);
            let t = render::drag_target(&self.core.camera.borrow(), o, d, anchor);
            self.core.solver.set_drag_target(t);
        }
    }

    pub fn pointer_up(&self) {
        self.core.pulling.set(None);
        self.core.solver.end_drag();
    }

    pub fn dragging(&self) -> bool {
        self.core.pulling.get().is_some()
    }

    pub fn orbit(&self, dx: f32, dy: f32) {
        self.core.camera.borrow_mut().orbit(dx, dy);
    }

    pub fn zoom(&self, steps: f32) {
        self.core.camera.borrow_mut().zoom(steps);
    }

    pub fn set_fast(&self, on: bool) {
        self.core.fast.set(on);
    }

    pub fn set_paused(&self, on: bool) {
        self.core.paused.set(on);
    }

    pub fn reset(&self) {
        self.core.solver.reset(&self.core.gpu.queue);
        self.core.solver.end_drag();
        self.core.sim_frame.set(0);
    }

    pub fn sim_time(&self) -> f32 {
        self.core.sim_frame.get() as f32 * self.core.solver.cfg.frame_dt
    }

    pub fn vertices(&self) -> u32 {
        self.core.n_verts
    }

    /// Asset load timings (JSON).
    pub fn load_info(&self) -> String {
        self.load.clone()
    }

    pub fn adapter_report(&self) -> String {
        serde_json::to_string(&self.core.gpu.report).unwrap_or_default()
    }
}
