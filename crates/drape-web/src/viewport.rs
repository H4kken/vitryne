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

use glam::{Vec3, Vec4Swizzles};
use serde::Serialize;
use vitryne_format::Placement;
use vitryne_pattern::{export::ExportFabric, project::Placer};
use vitryne_render::{self as render, OrbitCamera, Renderer, Style};
use vitryne_solver::{
    body::Sdf,
    engine::{Body, BodyOptions, Engine, Garment, SdfSource, Simulation},
    gpu,
    sim::DragPatch,
};
use wasm_bindgen::prelude::*;
use web_time::Instant;

use crate::PreparedScene;

/// The drape being shown. Shared (`Rc`) so an async call can hold it across an await while
/// a frame draws it; a new drape is a new `Live`.
struct Live {
    sim: Simulation,
    renderer: RefCell<Renderer>,
    n_verts: u32,
    /// Places the garment again for a cut being moved, and the cut shown moved (panel index,
    /// placement) until the next drape.
    placer: Placer,
    moved: RefCell<Option<(usize, Placement)>>,
    /// Each panel's (cut's) vertices, and its cut id.
    panels: Vec<std::ops::Range<u32>>,
    cuts: Vec<String>,
    /// Each panel's colour and export material: from the drape's document, then from
    /// `set_looks` (an appearance edit doesn't re-drape).
    colors: RefCell<Vec<Option<[f32; 3]>>>,
    export_fabrics: RefCell<Vec<ExportFabric>>,
    /// The garment's seams (sewing pairs by seam, in the document's order), for drawing them.
    seams: Vec<(String, Vec<(u32, u32)>)>,
}

/// The body alone (a garment with no pieces yet), and the garment's camera.
struct Bare {
    renderer: RefCell<Renderer>,
    camera: (Vec3, f32),
}

struct Core {
    engine: Engine,
    surface: wgpu::Surface<'static>,
    config: RefCell<wgpu::SurfaceConfiguration>,
    camera: RefCell<OrbitCamera>,
    live: RefCell<Option<Rc<Live>>>,
    /// Shown instead of a drape when there is nothing to drape.
    bare: RefCell<Option<Rc<Bare>>>,
    /// The body and its SDF key, kept across garment changes.
    body: RefCell<Option<(String, Arc<Body>)>>,
    pulling: Cell<Option<Vec3>>,
    fast: Cell<bool>,
    paused: Cell<bool>,
    /// Placing pieces: the cloth stays where it starts.
    placing: Cell<bool>,
    /// Seams drawn on the cloth.
    show_seams: Cell<bool>,
    /// The seam picked out (its index, hovered in the editor's list): drawn alone, even when
    /// the seams are hidden. Kept for later drapes.
    seam_highlight: Cell<Option<u32>>,
    lost: Arc<AtomicBool>,
    style: Cell<Style>,
    /// The cut picked out (hovered in the editor's list): the other cuts fade. Kept for later
    /// drapes.
    highlight: RefCell<Option<String>>,
    /// Offscreen target for `measure_frame` (same size/format as the canvas, never presented).
    offscreen: RefCell<Option<(wgpu::TextureView, u32, u32)>>,
}

/// How far the cuts other than the highlighted one go towards the background colour.
const HIGHLIGHT_FADE: f32 = 0.7;

impl Core {
    /// Whether frames advance the drape: when not paused, or while the cloth is held (a pinch
    /// works on a paused drape, which stays where it is let go).
    fn stepping(&self) -> bool {
        (!self.paused.get() || self.pulling.get().is_some()) && !self.placing.get()
    }

    /// Gives `live`'s renderer the seams to draw: the highlighted one alone, or all of them
    /// when they are shown.
    fn draw_seams(&self, live: &Live) {
        let only = self
            .seam_highlight
            .get()
            .map(|k| k as usize)
            .filter(|&k| k < live.seams.len());
        let mut renderer = live.renderer.borrow_mut();
        renderer.set_seams(
            &self.engine.gpu().device,
            &vitryne_render::seam_segments_of(&live.seams, only),
        );
        renderer.show_seams(only.is_some() || self.show_seams.get());
    }

    /// Writes `live`'s panel colours to its renderer, the cuts other than the highlighted one
    /// faded towards the background (`plain`: none faded, for thumbnails).
    fn paint(&self, live: &Live, plain: bool) {
        let colors = live.colors.borrow();
        let picked = self.highlight.borrow();
        let picked = picked
            .as_deref()
            .filter(|_| !plain)
            .and_then(|id| live.cuts.iter().position(|c| c == id));
        let queue = &self.engine.gpu().queue;
        let renderer = live.renderer.borrow();
        let Some(k) = picked else {
            return renderer.set_panel_colors(queue, &live.panels, &colors);
        };
        let style = self.style.get();
        let faded: Vec<_> = colors
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let c = c.unwrap_or(style.cloth);
                Some(if i == k {
                    c
                } else {
                    std::array::from_fn(|j| c[j] + (style.background[j] - c[j]) * HIGHLIGHT_FADE)
                })
            })
            .collect();
        renderer.set_panel_colors(queue, &live.panels, &faded);
    }

    fn aspect(&self) -> f32 {
        let cfg = self.config.borrow();
        cfg.width as f32 / cfg.height.max(1) as f32
    }
}

/// A cut's handles on screen (see the editor's gizmo), in normalized device coordinates
/// (-1..1, y up). Each `per` is how far the screen point moves per unit of the placement value
/// the handle changes: radians of `angle`, mm of `top`, mm of `radius`.
#[derive(Serialize)]
struct GizmoView {
    centre: [f32; 2],
    along: Handle,
    around: Handle,
    out: Handle,
    /// The turning ring (rotation: from `around` towards `along` is positive).
    ring: Vec<[f32; 2]>,
}

#[derive(Serialize)]
struct Handle {
    /// The handle's line, from one end to the other.
    line: Vec<[f32; 2]>,
    per: [f32; 2],
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
                bare: RefCell::new(None),
                body: RefCell::new(None),
                pulling: Cell::new(None),
                fast: Cell::new(false),
                paused: Cell::new(false),
                placing: Cell::new(false),
                show_seams: Cell::new(false),
                seam_highlight: Cell::new(None),
                lost,
                style: Cell::new(Style::default()),
                highlight: RefCell::new(None),
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
        // Drop the old drape first: its buffers are freed before the new ones are made.
        c.pulling.set(None);
        *c.live.borrow_mut() = None;
        *c.bare.borrow_mut() = None;
        if frame_camera {
            let (target, distance) = scene.inner.camera;
            *c.camera.borrow_mut() = OrbitCamera::looking_at(target, distance);
        }
        let Some(p) = &p.cloth else {
            let mut renderer = Renderer::body_only(
                &c.engine.gpu().device,
                c.config.borrow().format,
                &body.render,
            );
            renderer.set_style(&c.engine.gpu().queue, &c.style.get());
            *c.bare.borrow_mut() = Some(Rc::new(Bare {
                renderer: RefCell::new(renderer),
                camera: scene.inner.camera,
            }));
            return Ok(baked);
        };
        let garment = Arc::new(Garment::load_with_materials(
            &p.garment,
            &p.fabric,
            &p.panel_fabrics,
        )?);
        let sim = c.engine.simulate(&garment, &body, &p.settings);
        let mut renderer = Renderer::new(
            &c.engine.gpu().device,
            c.config.borrow().format,
            garment.mesh(),
            &garment.desc.sew_pairs,
            sim.solver(),
            &body.render,
        );
        renderer.set_style(&c.engine.gpu().queue, &c.style.get());
        let panels: Vec<_> = garment.desc.groups.iter().map(|(_, r)| r.clone()).collect();
        *c.live.borrow_mut() = Some(Rc::new(Live {
            n_verts: sim.n_verts(),
            sim,
            renderer: RefCell::new(renderer),
            placer: p.placer.clone(),
            moved: RefCell::new(None),
            panels,
            cuts: scene.inner.info.cuts.clone(),
            colors: RefCell::new(p.panel_colors.clone()),
            export_fabrics: RefCell::new(p.export_fabrics.clone()),
            seams: garment.desc.seams.clone(),
        }));
        if let Some(live) = c.live.borrow().as_ref() {
            c.draw_seams(live);
            c.paint(live, false);
        }
        Ok(baked)
    }

    /// The scene's colours, as twelve numbers 0..1: background, cloth (front), cloth (back),
    /// body, each r, g, b. Kept for later drapes.
    pub fn set_style(&self, rgb: &[f32]) -> Result<(), JsValue> {
        let c = |i: usize| -> Result<[f32; 3], JsValue> {
            rgb.get(i * 3..i * 3 + 3)
                .and_then(|s| s.try_into().ok())
                .ok_or_else(|| "set_style: twelve numbers".into())
        };
        let style = Style {
            background: c(0)?,
            cloth: c(1)?,
            cloth_back: c(2)?,
            body: c(3)?,
        };
        self.core.style.set(style);
        let gpu = self.core.engine.gpu();
        if let Some(live) = self.core.live.borrow().as_ref() {
            live.renderer.borrow_mut().set_style(&gpu.queue, &style);
            if self.core.highlight.borrow().is_some() {
                self.core.paint(live, false);
            }
        }
        if let Some(bare) = self.core.bare.borrow().as_ref() {
            bare.renderer.borrow_mut().set_style(&gpu.queue, &style);
        }
        Ok(())
    }

    /// Recolours the drape shown (and its export materials) from `file`'s appearances, after
    /// an edit that changes only them. Cuts the drape doesn't have yet wait for the next drape,
    /// and a document that can't be draped leaves the colours as they are.
    pub fn set_looks(&self, file: &crate::VtryFile) {
        let Some(live) = self.core.live.borrow().clone() else {
            return;
        };
        let Ok(looks) = file.file.looks() else {
            return;
        };
        {
            let mut colors = live.colors.borrow_mut();
            let mut export = live.export_fabrics.borrow_mut();
            for (k, id) in live.cuts.iter().enumerate() {
                if let Some(look) = looks.get(id) {
                    if let Some(c) = colors.get_mut(k) {
                        *c = look.color;
                    }
                    if let Some(e) = export.get_mut(k) {
                        *e = look.export.clone();
                    }
                }
            }
        }
        self.core.paint(&live, false);
    }

    /// Picks out cut `cut` (its id): the other cuts fade until it is none. Kept for later
    /// drapes; a cut the drape doesn't have fades nothing.
    pub fn set_highlight(&self, cut: Option<String>) {
        if *self.core.highlight.borrow() == cut {
            return;
        }
        *self.core.highlight.borrow_mut() = cut;
        if let Some(live) = self.core.live.borrow().as_ref() {
            self.core.paint(live, false);
        }
    }

    /// Drops the drape (a document that can't be draped); the body stays cached.
    pub fn clear(&self) {
        self.core.pulling.set(None);
        *self.core.live.borrow_mut() = None;
        *self.core.bare.borrow_mut() = None;
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
        let bare = c.bare.borrow().clone();
        match (live, bare) {
            (Some(live), _) => {
                // Params are written per sim frame, and queue writes apply at submit, so each
                // extra sim frame gets its own submit.
                if c.stepping() && c.fast.get() {
                    live.sim.step(7);
                }
                if c.stepping() {
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
            (None, Some(bare)) => bare.renderer.borrow_mut().draw(
                &gpu.device,
                &gpu.queue,
                &mut enc,
                &view,
                cfg.width,
                cfg.height,
                &c.camera.borrow(),
            ),
            (None, None) => {
                enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("empty"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear({
                                let [r, g, b] = c.style.get().background.map(f64::from);
                                wgpu::Color { r, g, b, a: 1.0 }
                            }),
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
            if c.stepping() {
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

    /// Placing pieces (on) or draping (off). Either way the cloth goes back to where it starts:
    /// while placing it stays there, so a cut's handles are where the cut starts.
    pub fn set_placing(&self, on: bool) {
        if self.core.placing.get() != on {
            self.core.placing.set(on);
            self.reset();
        }
    }

    /// Draws the garment's seams on the cloth (on) or not. Kept for later drapes.
    pub fn set_show_seams(&self, on: bool) {
        self.core.show_seams.set(on);
        if let Some(live) = self.core.live.borrow().as_ref() {
            self.core.draw_seams(live);
        }
    }

    /// Picks out seam `seam` (its index in the garment's seams): drawn alone on the cloth, even
    /// while the seams are hidden; or none. Kept for later drapes.
    pub fn set_seam_highlight(&self, seam: Option<u32>) {
        if self.core.seam_highlight.get() == seam {
            return;
        }
        self.core.seam_highlight.set(seam);
        if let Some(live) = self.core.live.borrow().as_ref() {
            self.core.draw_seams(live);
        }
    }

    /// The cut under the pointer (normalized device coordinates): its panel index, or -1.
    pub fn pick_cut(&self, x: f32, y: f32) -> js_sys::Promise {
        let c = self.core.clone();
        let (o, d) = self.ray(x, y);
        wasm_bindgen_futures::future_to_promise(async move {
            let Some(live) = c.live.borrow().clone() else {
                return Ok(JsValue::from_f64(-1.0));
            };
            let pos = live.sim.read_positions().await;
            let v = render::pick(&pos, o, d, 0.015);
            let panel = v.and_then(|v| live.panels.iter().position(|r| r.contains(&v)));
            Ok(JsValue::from_f64(panel.map_or(-1.0, |p| p as f64)))
        })
    }

    /// Shows cut `cut` (panel index) where `placement` (JSON) puts it, the other cuts where
    /// they start; while placing. The next drape (after the edit) starts from there too.
    pub fn place_cut(&self, cut: u32, placement: &str) -> Result<(), JsValue> {
        let p: Placement =
            serde_json::from_str(placement).map_err(|e| format!("placement: {e}"))?;
        let Some(live) = self.core.live.borrow().clone() else {
            return Ok(());
        };
        let pos = live.placer.positions(cut as usize, &p)?;
        live.sim.place_at(&pos)?;
        *live.moved.borrow_mut() = Some((cut as usize, p));
        Ok(())
    }

    /// Cut `cut`'s (panel index) handles as JSON (`GizmoView`), or "" when it has none: it
    /// follows another cut, or its middle is behind the camera.
    pub fn gizmo(&self, cut: u32) -> String {
        let c = &self.core;
        let Some(live) = c.live.borrow().clone() else {
            return String::new();
        };
        let cut = cut as usize;
        let Some(own) = live.placer.cuts().get(cut) else {
            return String::new();
        };
        let placement = match &*live.moved.borrow() {
            Some((k, p)) if *k == cut => p.clone(),
            _ => own.placement.clone(),
        };
        if matches!(placement, Placement::Follow(_)) {
            return String::new();
        }
        let Ok(g) = live.placer.gizmo(cut, &placement) else {
            return String::new();
        };
        let vp = c.camera.borrow().view_proj(c.aspect());
        let clip = |p: Vec3| vp * p.extend(1.0);
        let b = g.basis;
        if clip(b.point).w <= 1e-4 {
            return String::new();
        }
        let ndc = |p: Vec3| {
            let q = clip(p);
            let q = q.xy() / q.w.max(1e-4);
            [q.x, q.y]
        };
        let per = |dir: Vec3, step: f32| {
            let (a, z) = (ndc(b.point), ndc(b.point + dir * step));
            [(z[0] - a[0]) / step, (z[1] - a[1]) / step]
        };
        let reach = (0.3 * g.size.y).clamp(0.06, 0.18);
        let arc: Vec<[f32; 2]> = (-8..=8)
            .map(|k| {
                let t = k as f32 / 8.0 * reach / g.radius;
                ndc(b.point + g.radius * (t.sin() * b.around + (t.cos() - 1.0) * b.out))
            })
            .collect();
        let ring: Vec<[f32; 2]> = (0..=32)
            .map(|k| {
                let t = k as f32 / 32.0 * std::f32::consts::TAU;
                ndc(b.point + 0.55 * reach * (t.cos() * b.around + t.sin() * b.along))
            })
            .collect();
        let view = GizmoView {
            centre: ndc(b.point),
            along: Handle {
                line: vec![
                    ndc(b.point - reach * b.along),
                    ndc(b.point + reach * b.along),
                ],
                // mm: a 1 mm step.
                per: per(b.along * 0.001, 1.0),
            },
            around: Handle {
                line: arc,
                // Radians: the point moves `radius` metres per radian.
                per: per(b.around * g.radius, 0.001),
            },
            out: Handle {
                line: vec![ndc(b.point), ndc(b.point + 0.08 * b.out)],
                per: per(b.out * 0.001, 1.0),
            },
            ring,
        };
        serde_json::to_string(&view).unwrap_or_default()
    }

    pub fn adapter_report(&self) -> String {
        serde_json::to_string(&self.core.engine.gpu().report).unwrap_or_default()
    }

    /// The drape as it is now, `w` × `h`, from the garment's own camera (not the one the person
    /// turned): RGBA8 pixels as a `Uint8Array`, for the project's thumbnail.
    pub fn thumbnail(&self, w: u32, h: u32) -> js_sys::Promise {
        let c = self.core.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let gpu = c.engine.gpu();
            let (w, h) = (w.max(1), h.max(1));
            // The renderer isn't borrowed while the image comes back (frames go on meanwhile).
            let live = c.live.borrow().clone();
            let bare = c.bare.borrow().clone();
            let shot = match (live, bare) {
                (Some(live), _) => {
                    let (target, distance) = live.sim.garment().desc.camera;
                    let camera = OrbitCamera::looking_at(target, distance);
                    // The thumbnail shows every cut in its colour, even while one is picked out.
                    let picked = c.highlight.borrow().is_some();
                    if picked {
                        c.paint(&live, true);
                    }
                    let shot =
                        live.renderer
                            .borrow_mut()
                            .snapshot(&gpu.device, &gpu.queue, w, h, &camera);
                    if picked {
                        c.paint(&live, false);
                    }
                    shot
                }
                (None, Some(bare)) => {
                    let camera = OrbitCamera::looking_at(bare.camera.0, bare.camera.1);
                    bare.renderer
                        .borrow_mut()
                        .snapshot(&gpu.device, &gpu.queue, w, h, &camera)
                }
                (None, None) => return Err(JsValue::from_str("no garment loaded")),
            };
            let rgba = shot.read(&gpu.device).await;
            Ok(JsValue::from(js_sys::Uint8Array::from(&rgba[..])))
        })
    }

    /// Exports the current drape as a glTF 2.0 binary (`.glb`), returning a `Uint8Array`.
    pub fn export_glb(&self, include_avatar: bool) -> js_sys::Promise {
        let c = self.core.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let Some(live) = c.live.borrow().clone() else {
                return Err(JsValue::from_str("no garment loaded"));
            };
            let positions = live.sim.read_positions().await;
            let normals = live.sim.garment().mesh().vertex_normals(&positions);
            let uvs: Vec<glam::Vec2> = live
                .sim
                .garment()
                .desc
                .mesh
                .rest
                .iter()
                .map(|p| glam::Vec2::new(p.x, p.y))
                .collect();
            let export_data = vitryne_pattern::export::GarmentExportData::new(
                &live.sim.garment().desc,
                &positions,
                &normals,
                &uvs,
                &live.export_fabrics.borrow(),
            );
            let mut av_tris_storage = Vec::new();
            let av_export = if include_avatar {
                Some(vitryne_pattern::export::AvatarExportData::from_body(
                    live.sim.body(),
                    &mut av_tris_storage,
                ))
            } else {
                None
            };
            let glb_bytes = vitryne_pattern::export::export_glb(&export_data, av_export.as_ref())
                .map_err(|e| JsValue::from_str(&e))?;
            let array = js_sys::Uint8Array::from(&glb_bytes[..]);
            Ok(JsValue::from(array))
        })
    }

    /// Exports the current drape as Wavefront OBJ (`.obj` + `.mtl`), returning JSON
    /// string `{"obj": "...", "mtl": "..."}`.
    pub fn export_obj(&self, include_avatar: bool) -> js_sys::Promise {
        let c = self.core.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let Some(live) = c.live.borrow().clone() else {
                return Err(JsValue::from_str("no garment loaded"));
            };
            let positions = live.sim.read_positions().await;
            let normals = live.sim.garment().mesh().vertex_normals(&positions);
            let uvs: Vec<glam::Vec2> = live
                .sim
                .garment()
                .desc
                .mesh
                .rest
                .iter()
                .map(|p| glam::Vec2::new(p.x, p.y))
                .collect();
            let export_data = vitryne_pattern::export::GarmentExportData::new(
                &live.sim.garment().desc,
                &positions,
                &normals,
                &uvs,
                &live.export_fabrics.borrow(),
            );
            let mut av_tris_storage = Vec::new();
            let av_export = if include_avatar {
                Some(vitryne_pattern::export::AvatarExportData::from_body(
                    live.sim.body(),
                    &mut av_tris_storage,
                ))
            } else {
                None
            };
            let obj_export = vitryne_pattern::export::export_obj(
                &export_data,
                av_export.as_ref(),
                Some("garment.mtl"),
            );
            #[derive(Serialize)]
            struct ObjResult<'a> {
                obj: &'a str,
                mtl: &'a str,
            }
            let json = serde_json::to_string(&ObjResult {
                obj: &obj_export.obj,
                mtl: &obj_export.mtl,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
            Ok(JsValue::from_str(&json))
        })
    }
}
