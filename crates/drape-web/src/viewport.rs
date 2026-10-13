// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor's 3D viewport, in the worker: one device and surface on an OffscreenCanvas for
//! the worker's lifetime; the drape is replaced whenever the document's garment changes (the
//! body and its SDF are kept while their key is the same). Frames are driven from JS.
//! Picking reads positions back once per pointer-down (not per frame).

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use drape_core::{
    body::Sdf,
    engine::{Body, BodyOptions, Engine, Garment, SdfSource, Simulation},
    gpu,
    sim::DragPatch,
};
use drape_render::{self as render, OrbitCamera, Renderer};
use glam::Vec3;
use wasm_bindgen::prelude::*;
use web_time::Instant;

use crate::PreparedScene;

/// The drape being shown. Shared (`Rc`) so an async call can hold it across an await while
/// a frame draws it; a new drape is a new `Live`.
struct Live {
    sim: Simulation,
    renderer: RefCell<Renderer>,
    n_verts: u32,
}

struct Core {
    engine: Engine,
    surface: wgpu::Surface<'static>,
    config: RefCell<wgpu::SurfaceConfiguration>,
    camera: RefCell<OrbitCamera>,
    live: RefCell<Option<Rc<Live>>>,
    /// The body and its SDF key, kept across garment changes.
    body: RefCell<Option<(String, Arc<Body>)>>,
    pulling: Cell<Option<Vec3>>,
    fast: Cell<bool>,
    paused: Cell<bool>,
    lost: Arc<AtomicBool>,
    /// Offscreen target for `measure_frame` (same size/format as the canvas, never presented).
    offscreen: RefCell<Option<(wgpu::TextureView, u32, u32)>>,
}

#[wasm_bindgen]
pub struct Viewport {
    core: Rc<Core>,
}

#[wasm_bindgen]
impl Viewport {
    /// The device and surface on `canvas`; nothing to draw until `load`.
    pub async fn create(canvas: web_sys::OffscreenCanvas) -> Result<Viewport, JsValue> {
        let (w, h) = (canvas.width().max(1), canvas.height().max(1));
        let instance = gpu::create_instance();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(|e| format!("create_surface: {e}"))?;
        let g = gpu::Gpu::new(&instance, Some(&surface), gpu::GpuOptions::default()).await?;
        if g.report.backend != "BrowserWebGpu" {
            return Err(format!("expected BrowserWebGpu backend, got {}", g.report.backend).into());
        }
        let config = surface
            .get_default_config(&g.adapter, w, h)
            .ok_or("surface unsupported by adapter")?;
        surface.configure(&g.device, &config);
        let lost = Arc::new(AtomicBool::new(false));
        let flag = lost.clone();
        g.device.set_device_lost_callback(move |reason, msg| {
            log::error!("GPU device lost ({reason:?}): {msg}");
            flag.store(true, Ordering::Relaxed);
        });
        Ok(Viewport {
            core: Rc::new(Core {
                engine: Engine::new(g),
                surface,
                config: RefCell::new(config),
                camera: RefCell::new(OrbitCamera::default()),
                live: RefCell::new(None),
                body: RefCell::new(None),
                pulling: Cell::new(None),
                fast: Cell::new(false),
                paused: Cell::new(false),
                lost,
                offscreen: RefCell::new(None),
            }),
        })
    }

    /// True once the device is lost: the worker is restarted then.
    pub fn lost(&self) -> bool {
        self.core.lost.load(Ordering::Relaxed)
    }

    /// Whether the body for this SDF key is already loaded (then `load` needs no SDF).
    pub fn has_body(&self, sdf_key: &str) -> bool {
        matches!(&*self.core.body.borrow(), Some((k, _)) if k == sdf_key)
    }

    /// Replaces the drape with `scene`, from the start. The body is reused when its SDF key is
    /// unchanged; otherwise `sdf` (the bundled or cached bytes) is used, or, when empty, the
    /// SDF is baked here (seconds) with `progress(fraction)` calls, and its bytes returned for
    /// the cache. `frame_camera`: aim the camera at the garment (on open, not after an edit).
    pub fn load(
        &self,
        scene: &PreparedScene,
        sdf: Vec<u8>,
        progress: &js_sys::Function,
        frame_camera: bool,
    ) -> Result<Option<Vec<u8>>, JsValue> {
        let c = &self.core;
        let p = &scene.inner;
        let mut baked = None;
        if !self.has_body(&p.info.sdf_key) {
            let t0 = Instant::now();
            let from_bytes = !sdf.is_empty();
            let opts = BodyOptions {
                sdf: if from_bytes {
                    SdfSource::Bytes(sdf)
                } else {
                    SdfSource::Bake(p.sdf.clone())
                },
            };
            let mut report = |f: f32| {
                let _ = progress.call1(&JsValue::NULL, &JsValue::from_f64(f as f64));
            };
            let body =
                Body::from_mesh_with_progress(&p.avatar, p.mesh.clone(), &opts, &mut report)?;
            if !from_bytes {
                baked = body.sdf().map(|s| Sdf::to_bytes(s));
            }
            log::info!(
                "body {}: SDF {} in {:.0} ms",
                p.avatar,
                if from_bytes { "loaded" } else { "baked" },
                t0.elapsed().as_secs_f64() * 1000.0
            );
            *c.body.borrow_mut() = Some((p.info.sdf_key.clone(), Arc::new(body)));
        }
        let body = c.body.borrow().as_ref().expect("set above").1.clone();
        let garment = Arc::new(Garment::load(&p.garment, &p.fabric)?);
        // Drop the old drape first: its buffers are freed before the new ones are made.
        c.pulling.set(None);
        *c.live.borrow_mut() = None;
        let sim = c.engine.simulate(&garment, &body, &p.settings);
        let renderer = Renderer::new(
            &c.engine.gpu().device,
            c.config.borrow().format,
            garment.mesh(),
            sim.solver(),
            &body.render,
        );
        if frame_camera {
            let (target, distance) = garment.desc.camera;
            *c.camera.borrow_mut() = OrbitCamera::looking_at(target, distance);
        }
        *c.live.borrow_mut() = Some(Rc::new(Live {
            n_verts: sim.n_verts(),
            sim,
            renderer: RefCell::new(renderer),
        }));
        Ok(baked)
    }

    /// Drops the drape (a document that can't be draped); the body stays cached.
    pub fn clear(&self) {
        self.core.pulling.set(None);
        *self.core.live.borrow_mut() = None;
    }

    /// One display frame: 1 sim frame (8 in fast-drape mode) + render + present. False if the
    /// device is lost.
    pub fn frame(&self) -> bool {
        let c = &self.core;
        if self.lost() {
            return false;
        }
        let gpu = c.engine.gpu();
        let Some(frame) = (match c.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => Some(f),
            _ => None,
        }) else {
            c.surface.configure(&gpu.device, &c.config.borrow());
            return true;
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        let cfg = c.config.borrow();
        let live = c.live.borrow().clone();
        match live {
            Some(live) => {
                // Params are written per sim frame, and queue writes apply at submit, so each
                // extra sim frame gets its own submit.
                if !c.paused.get() && c.fast.get() {
                    live.sim.step(7);
                }
                if !c.paused.get() {
                    live.sim.encode_step(&mut enc, None);
                }
                live.renderer.borrow_mut().draw(
                    &gpu.device,
                    &gpu.queue,
                    &mut enc,
                    &view,
                    cfg.width,
                    cfg.height,
                    &c.camera.borrow(),
                );
            }
            None => {
                enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("empty"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(render::CLEAR_COLOR),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
            }
        }
        gpu.queue.submit([enc.finish()]);
        gpu.queue.present(frame);
        true
    }

    /// Cost of one display frame's work (1 sim frame + render), submit -> GPU done, in ms,
    /// rendered offscreen so it doesn't wait for the compositor. Advances the sim by one frame.
    /// Sampled (about once a second), not per frame. NaN without a drape.
    pub fn measure_frame(&self) -> js_sys::Promise {
        let c = self.core.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let gpu = c.engine.gpu();
            let (w, h, format) = {
                let cfg = c.config.borrow();
                (cfg.width, cfg.height, cfg.format)
            };
            let view = {
                let mut off = c.offscreen.borrow_mut();
                if !matches!(&*off, Some((_, ow, oh)) if *ow == w && *oh == h) {
                    let tex = gpu.device.create_texture(&wgpu::TextureDescriptor {
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
            let Some(live) = c.live.borrow().clone() else {
                return Ok(JsValue::from_f64(f64::NAN));
            };
            live.sim.wait().await;
            let t0 = Instant::now();
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            if !c.paused.get() {
                live.sim.encode_step(&mut enc, None);
            }
            live.renderer.borrow_mut().draw(
                &gpu.device,
                &gpu.queue,
                &mut enc,
                &view,
                w,
                h,
                &c.camera.borrow(),
            );
            gpu.queue.submit([enc.finish()]);
            live.sim.wait().await;
            Ok(JsValue::from_f64(t0.elapsed().as_secs_f64() * 1000.0))
        })
    }

    pub fn resize(&self, w: u32, h: u32) {
        let mut cfg = self.core.config.borrow_mut();
        cfg.width = w.max(1);
        cfg.height = h.max(1);
        self.core
            .surface
            .configure(&self.core.engine.gpu().device, &cfg);
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
            let Some(live) = c.live.borrow().clone() else {
                return Ok(JsValue::FALSE);
            };
            let pos = live.sim.read_positions().await;
            // The drape may have been replaced while reading.
            if !c
                .live
                .borrow()
                .as_ref()
                .is_some_and(|l| Rc::ptr_eq(l, &live))
            {
                return Ok(JsValue::FALSE);
            }
            let Some(v) = render::pick(&pos, o, d, 0.015) else {
                return Ok(JsValue::FALSE);
            };
            let patch = DragPatch::grab(
                live.sim.adjacency(),
                &pos,
                v,
                live.sim.settings().drag_radius,
            );
            live.sim.grab_patch(&patch, pos[v as usize]);
            c.pulling.set(Some(pos[v as usize]));
            Ok(JsValue::TRUE)
        })
    }

    pub fn pointer_move(&self, x: f32, y: f32) {
        if let Some(anchor) = self.core.pulling.get()
            && let Some(live) = self.core.live.borrow().as_ref()
        {
            let (o, d) = self.ray(x, y);
            let t = render::drag_target(&self.core.camera.borrow(), o, d, anchor);
            live.sim.set_target(t);
        }
    }

    pub fn pointer_up(&self) {
        self.core.pulling.set(None);
        if let Some(live) = self.core.live.borrow().as_ref() {
            live.sim.release();
        }
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

    /// Restarts the drape from the placed pattern.
    pub fn reset(&self) {
        if let Some(live) = self.core.live.borrow().as_ref() {
            live.sim.reset();
        }
    }

    pub fn sim_time(&self) -> f32 {
        self.core
            .live
            .borrow()
            .as_ref()
            .map_or(0.0, |l| l.sim.time())
    }

    pub fn vertices(&self) -> u32 {
        self.core.live.borrow().as_ref().map_or(0, |l| l.n_verts)
    }

    pub fn adapter_report(&self) -> String {
        serde_json::to_string(&self.core.engine.gpu().report).unwrap_or_default()
    }
}
