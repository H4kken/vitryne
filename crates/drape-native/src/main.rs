//! Native entry point.
//!   drape [view]            winit viewer (drag = orbit, wheel = zoom, space = pause, R = reset,
//!                           F = fast drape: 8 sim frames per display frame)
//!   drape bench [--frames F] [--out file.json]
//!                           headless benchmark, prints JSON
//!   drape frames --at 30,120,600 --out-dir DIR [--cam yaw,pitch,dist[,tx,ty,tz]]
//!                           headless: render the sim at those frames to PNGs
//!   drape info              print adapter report as JSON and exit
//!   drape snapshot <out>    M0 triangle smoke test, offscreen, PPM
//!
//!   drape pattern-svg <out.svg> [--edge E]
//!                           meshed T-shirt pattern with seams, for inspection
//!
//! Scene: --scene sheet|tshirt (default sheet).
//!   sheet:  --grid N (vertices per side), --pin-spacing F, --no-sphere
//!   tshirt: --edge E (target edge length, m; 0.00864 ≈ 10k verts), --sdf-cell C (m)
//! Sim (any scene): --substeps S, --damping D, --friction MU.
//! `--gpu-timestamps` (any command): opt-in profiling mode, see `GpuOptions`.

use std::sync::Arc;

use drape_assets::tshirt::{self, SdfParams, TshirtParams};
use drape_core::{
    body::{BodyMesh, BodyQuery, Sdf},
    gpu,
    render::{OrbitCamera, Renderer},
    scene::{Built, SheetScene},
    sim::Solver,
    timer::GpuTimer,
    triangle::TriangleRenderer,
};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{Key, NamedKey},
    window::{Window, WindowId},
};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn")).init();
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let opts = gpu::GpuOptions { gpu_timestamps: take_flag(&mut args, "--gpu-timestamps") };
    let scene_args = SceneArgs::take(&mut args);
    let headless_gpu = || {
        let instance = gpu::create_instance();
        pollster::block_on(gpu::Gpu::new(&instance, None, opts)).expect("gpu init")
    };
    match args.first().map(String::as_str).unwrap_or("view") {
        "view" => run_viewer(opts, scene_args.build()),
        "info" => println!("{}", serde_json::to_string_pretty(&headless_gpu().report).unwrap()),
        "bench" => {
            let g = headless_gpu();
            let mut cfg = drape_core::bench::BenchConfig::default();
            if let Some(v) = take_value(&mut args, "--frames") {
                cfg.frames = v.parse().expect("--frames");
            }
            let out = take_value(&mut args, "--out");
            let built = scene_args.build();
            let r = pollster::block_on(drape_core::bench::run(&g, &built, cfg));
            let json = serde_json::to_string_pretty(&r).unwrap();
            if let Some(path) = out {
                std::fs::write(&path, &json).expect("write --out");
            }
            println!("{json}");
        }
        "frames" => {
            let at: Vec<u32> = take_value(&mut args, "--at")
                .unwrap_or_else(|| "0,30,60,120,300,600".into())
                .split(',')
                .map(|s| s.parse().expect("--at"))
                .collect();
            let dir = take_value(&mut args, "--out-dir").unwrap_or_else(|| ".".into());
            // --cam yaw,pitch,distance[,tx,ty,tz] overrides the scene camera.
            let cam = take_value(&mut args, "--cam").map(|v| v.split(',').map(|x| x.parse::<f32>().expect("--cam")).collect::<Vec<_>>());
            render_frames(&headless_gpu(), &scene_args.build(), &at, &dir, cam);
        }
        "pattern-svg" => {
            let out = args.get(1).cloned().unwrap_or_else(|| "pattern.svg".into());
            pattern_svg(&out, scene_args.tshirt.edge);
        }
        "snapshot" => {
            let out = args.get(1).map(String::as_str).unwrap_or("triangle.ppm");
            snapshot(&headless_gpu(), out);
        }
        other => {
            eprintln!("unknown command '{other}' (view | bench | frames | pattern-svg | info | snapshot)");
            std::process::exit(2);
        }
    }
}

struct SceneArgs {
    kind: String,
    sheet: SheetScene,
    tshirt: TshirtParams,
    sdf: SdfParams,
    sim: drape_core::sim::SimConfig,
}

impl SceneArgs {
    fn take(args: &mut Vec<String>) -> Self {
        let mut a = Self {
            kind: take_value(args, "--scene").unwrap_or_else(|| "sheet".into()),
            sheet: SheetScene::default(),
            tshirt: TshirtParams::default(),
            sdf: SdfParams::default(),
            sim: SheetScene::config(),
        };
        let num = |args: &mut Vec<String>, flag: &str| take_value(args, flag).map(|v| v.parse::<f32>().unwrap_or_else(|_| panic!("{flag}")));
        if let Some(v) = take_value(args, "--grid") {
            a.sheet.grid = v.parse().expect("--grid");
        }
        if let Some(v) = num(args, "--pin-spacing") {
            a.sheet.pin_spacing = v;
        }
        if take_flag(args, "--no-sphere") {
            a.sheet.sphere_center = [0.0, -100.0, 0.0];
        }
        if let Some(v) = num(args, "--edge") {
            a.tshirt.edge = v;
        }
        if let Some(v) = num(args, "--sdf-cell") {
            a.sdf.cell = v;
        }
        if let Some(v) = take_value(args, "--substeps") {
            a.sim.substeps = v.parse().expect("--substeps");
        }
        if let Some(v) = num(args, "--damping") {
            a.sim.damping = v;
        }
        if let Some(v) = num(args, "--friction") {
            a.sim.friction = v;
        }
        a
    }

    fn build(&self) -> Built {
        match self.kind.as_str() {
            "sheet" => self.sheet.build(self.sim),
            "tshirt" => {
                let t0 = std::time::Instant::now();
                let obj = std::fs::read_to_string(BODY_OBJ).unwrap_or_else(|e| panic!("{BODY_OBJ}: {e}"));
                let body = std::sync::Arc::new(BodyQuery::new(BodyMesh::from_obj(&obj).expect("parse body obj")));
                log::info!("body: {} verts, {} tris, BVH in {:.0} ms", body.mesh.pos.len(), body.mesh.tris.len(), t0.elapsed().as_secs_f64() * 1000.0);
                let sdf = std::sync::Arc::new(load_or_bake_sdf(&obj, &body, &self.sdf));
                tshirt::build(&self.tshirt, body, sdf, self.sim)
            }
            other => panic!("unknown --scene {other} (sheet | tshirt)"),
        }
    }
}

const BODY_OBJ: &str = "assets/body/makehuman_body_m.obj";

/// The bake takes seconds, so cache it under target/ keyed by body + SDF parameters.
fn load_or_bake_sdf(obj: &str, body: &BodyQuery, p: &SdfParams) -> Sdf {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in obj.bytes().chain(serde_json::to_string(p).unwrap().bytes()) {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    let path = format!("target/sdf-cache/{h:016x}.bin");
    if let Ok(bytes) = std::fs::read(&path) {
        if let Some(sdf) = Sdf::from_bytes(&bytes) {
            log::info!("SDF: loaded {path}");
            return sdf;
        }
    }
    let t0 = std::time::Instant::now();
    let sdf = p.bake(body);
    log::info!(
        "SDF: baked {}x{}x{} @ {:.1} mm in {:.2} s",
        sdf.dims.x,
        sdf.dims.y,
        sdf.dims.z,
        sdf.cell * 1000.0,
        t0.elapsed().as_secs_f64()
    );
    let _ = std::fs::create_dir_all("target/sdf-cache");
    let _ = std::fs::write(&path, sdf.to_bytes());
    sdf
}

fn pattern_svg(out: &str, edge: f32) {
    let pat = tshirt::pattern();
    let mp = drape_assets::meshing::mesh_pattern(&pat, edge);
    let scale = 1000.0; // 1 px per mm
    let offsets = [(320.0, 720.0), (920.0, 720.0), (320.0, 960.0), (920.0, 960.0)];
    let mut svg = String::from("<svg xmlns='http://www.w3.org/2000/svg' width='1450' height='1000' style='background:#fff'>\n");
    let at = |pi: usize, v: u32| {
        let q = mp.uv[v as usize];
        (offsets[pi].0 + q.x * scale, offsets[pi].1 - q.y * scale)
    };
    let panel_of = |v: u32| mp.panel_vertices.iter().position(|r| r.contains(&v)).unwrap();
    for t in &mp.mesh.tris {
        let pi = panel_of(t[0]);
        let p: Vec<String> = t.iter().map(|&v| at(pi, v)).map(|(x, y)| format!("{x:.1},{y:.1}")).collect();
        svg += &format!("<polygon points='{}' fill='#f3d7cf' stroke='#a66' stroke-width='0.3'/>\n", p.join(" "));
    }
    let colors = ["#06c", "#0a6", "#c60", "#90c", "#c03", "#088", "#660", "#36f", "#f39", "#393"];
    for (si, s) in pat.seams.iter().enumerate() {
        for (pi, ei) in [s.a, s.b] {
            let pts: Vec<String> = mp.edge_vertices[pi][ei].iter().map(|&v| at(pi, v)).map(|(x, y)| format!("{x:.1},{y:.1}")).collect();
            svg += &format!("<polyline points='{}' fill='none' stroke='{}' stroke-width='3'/>\n", pts.join(" "), colors[si % colors.len()]);
        }
        let (x, y) = at(s.a.0, mp.edge_vertices[s.a.0][s.a.1][0]);
        svg += &format!("<text x='{x:.0}' y='{y:.0}' font-size='11' fill='{}'>{}</text>\n", colors[si % colors.len()], s.name);
    }
    svg += &format!("<text x='10' y='20' font-size='14'>{} vertices, {} triangles, edge {:.1} mm</text>\n</svg>\n", mp.mesh.n_verts(), mp.mesh.tris.len(), edge * 1000.0);
    std::fs::write(out, svg).expect("write svg");
    println!("wrote {out}: {} vertices", mp.mesh.n_verts());
}

fn take_value(args: &mut Vec<String>, flag: &str) -> Option<String> {
    let i = args.iter().position(|a| a == flag)?;
    let v = args.get(i + 1).cloned().unwrap_or_else(|| panic!("{flag} needs a value"));
    args.drain(i..=i + 1);
    Some(v)
}

fn take_flag(args: &mut Vec<String>, flag: &str) -> bool {
    let before = args.len();
    args.retain(|a| a != flag);
    args.len() != before
}

/// Offscreen colour target + readback, sized so rows are 256-byte aligned.
struct Offscreen {
    tex: wgpu::Texture,
    view: wgpu::TextureView,
    readback: wgpu::Buffer,
    w: u32,
    h: u32,
}

impl Offscreen {
    const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

    fn new(device: &wgpu::Device, w: u32, h: u32) -> Self {
        assert_eq!((w * 4) % 256, 0);
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: Self::FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = tex.create_view(&Default::default());
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("offscreen-readback"),
            size: (w * h * 4) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        Self { tex, view, readback, w, h }
    }

    fn copy(&self, enc: &mut wgpu::CommandEncoder) {
        enc.copy_texture_to_buffer(
            self.tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &self.readback,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(self.w * 4), rows_per_image: Some(self.h) },
            },
            wgpu::Extent3d { width: self.w, height: self.h, depth_or_array_layers: 1 },
        );
    }

    fn read(&self, device: &wgpu::Device) -> Vec<u8> {
        pollster::block_on(drape_core::gpu_async::read_buffer::<u8>(device, &self.readback))
    }
}

fn write_png(path: &str, w: u32, h: u32, rgba: &[u8]) {
    let file = std::io::BufWriter::new(std::fs::File::create(path).expect("create png"));
    let mut enc = png::Encoder::new(file, w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(rgba).unwrap();
}

fn render_frames(g: &gpu::Gpu, built: &Built, at: &[u32], dir: &str, cam: Option<Vec<f32>>) {
    std::fs::create_dir_all(dir).unwrap();
    let solver = Solver::new(&g.device, &built.mesh, &built.constraints, built.material.density, built.sim, built.collider.clone());
    let off = Offscreen::new(&g.device, 1024, 768);
    let mut renderer = Renderer::new(&g.device, Offscreen::FORMAT, &built.mesh, &solver, &built.collider_mesh);
    let mut camera = OrbitCamera::looking_at(built.camera.0, built.camera.1);
    if let Some(c) = cam {
        camera.yaw = c[0];
        camera.pitch = c[1];
        camera.distance = c[2];
        if c.len() >= 6 {
            camera.target = glam::Vec3::new(c[3], c[4], c[5]);
        }
    }
    let last = *at.iter().max().unwrap_or(&0);
    for f in 0..=last {
        if at.contains(&f) {
            let mut enc = g.device.create_command_encoder(&Default::default());
            renderer.draw(&g.device, &g.queue, &mut enc, &off.view, off.w, off.h, &camera);
            off.copy(&mut enc);
            g.queue.submit([enc.finish()]);
            let px = off.read(&g.device);
            let path = format!("{dir}/frame{f:04}.png");
            write_png(&path, off.w, off.h, &px);
            println!("wrote {path}");
        }
        solver.prepare_frame(&g.queue, f);
        let mut enc = g.device.create_command_encoder(&Default::default());
        solver.encode_frame(&mut enc, None);
        g.queue.submit([enc.finish()]);
    }
}

fn snapshot(g: &gpu::Gpu, out: &str) {
    let (w, h) = (256u32, 256u32);
    let off = Offscreen::new(&g.device, w, h);
    let renderer = TriangleRenderer::new(&g.device, Offscreen::FORMAT);
    let mut timer = GpuTimer::new(&g.device, &g.queue, 1);
    let mut enc = g.device.create_command_encoder(&Default::default());
    timer.begin_frame();
    renderer.draw(&mut enc, &off.view, timer.render_pass_writes("triangle"));
    timer.resolve(&mut enc);
    off.copy(&mut enc);
    g.queue.submit([enc.finish()]);
    let data = off.read(&g.device);
    let mut ppm = format!("P6\n{w} {h}\n255\n").into_bytes();
    for px in data.chunks_exact(4) {
        ppm.extend_from_slice(&px[..3]);
    }
    std::fs::write(out, ppm).expect("write ppm");
    let c = ((h / 2 * w + w / 2) * 4) as usize;
    println!("wrote {out}; centre pixel rgb = {:?}", &data[c..c + 3]);
    if timer.enabled() {
        let times = pollster::block_on(timer.read(&g.device));
        println!("gpu pass times: {}", serde_json::to_string(&times).unwrap());
    }
}

struct Viewer {
    instance: wgpu::Instance,
    opts: gpu::GpuOptions,
    built: Built,
    state: Option<ViewerState>,
}

struct ViewerState {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    gpu: gpu::Gpu,
    solver: Solver,
    renderer: Renderer,
    camera: OrbitCamera,
    dragging: bool,
    last_cursor: Option<(f64, f64)>,
    paused: bool,
    fast: bool,
    sim_frame: u32,
    frames: u32,
    fps_t0: std::time::Instant,
}

fn run_viewer(opts: gpu::GpuOptions, built: Built) {
    let event_loop = EventLoop::new().expect("event loop");
    let mut app = Viewer { instance: gpu::create_instance(), opts, built, state: None };
    event_loop.run_app(&mut app).expect("run");
}

impl ApplicationHandler for Viewer {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        let window = Arc::new(el.create_window(Window::default_attributes().with_title("drape-spike (native)")).expect("window"));
        let surface = self.instance.create_surface(window.clone()).expect("surface");
        let gpu = pollster::block_on(gpu::Gpu::new(&self.instance, Some(&surface), self.opts)).expect("gpu init");
        let size = window.inner_size();
        let config = surface.get_default_config(&gpu.adapter, size.width.max(1), size.height.max(1)).expect("surface unsupported by adapter");
        surface.configure(&gpu.device, &config);
        let built = &self.built;
        let solver = Solver::new(&gpu.device, &built.mesh, &built.constraints, built.material.density, built.sim, built.collider.clone());
        let renderer = Renderer::new(&gpu.device, config.format, &built.mesh, &solver, &built.collider_mesh);
        log::info!(
            "scene: {} verts, {} stretch colours, {} bend colours, {} dispatches/frame",
            built.mesh.n_verts(),
            built.constraints.stretch.n_colors(),
            built.constraints.bend.n_colors(),
            solver.dispatches_per_frame()
        );
        window.request_redraw();
        self.state = Some(ViewerState {
            window,
            surface,
            config,
            gpu,
            solver,
            renderer,
            camera: OrbitCamera::looking_at(built.camera.0, built.camera.1),
            dragging: false,
            last_cursor: None,
            paused: false,
            fast: false,
            sim_frame: 0,
            frames: 0,
            fps_t0: std::time::Instant::now(),
        });
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(s) = self.state.as_mut() else { return };
        match event {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                s.config.width = size.width.max(1);
                s.config.height = size.height.max(1);
                s.surface.configure(&s.gpu.device, &s.config);
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                s.dragging = state == ElementState::Pressed;
            }
            WindowEvent::CursorMoved { position, .. } => {
                if let (true, Some((x, y))) = (s.dragging, s.last_cursor) {
                    s.camera.orbit((position.x - x) as f32, (position.y - y) as f32);
                }
                s.last_cursor = Some((position.x, position.y));
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let steps = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 40.0,
                };
                s.camera.zoom(steps);
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => match event.logical_key {
                Key::Named(NamedKey::Space) => s.paused = !s.paused,
                Key::Character(c) if c.eq_ignore_ascii_case("f") => s.fast = !s.fast,
                Key::Character(c) if c.eq_ignore_ascii_case("r") => {
                    s.solver.reset(&s.gpu.queue);
                    s.sim_frame = 0;
                }
                _ => {}
            },
            WindowEvent::RedrawRequested => {
                let frame = match s.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
                    _ => {
                        s.surface.configure(&s.gpu.device, &s.config);
                        s.window.request_redraw();
                        return;
                    }
                };
                let view = frame.texture.create_view(&Default::default());
                let mut enc = s.gpu.device.create_command_encoder(&Default::default());
                if !s.paused {
                    // Each sim frame gets its own encoder: params are written per sim frame,
                    // and queue writes apply at submit, not at their position in an encoder.
                    for _ in 0..if s.fast { 7 } else { 0 } {
                        s.solver.prepare_frame(&s.gpu.queue, s.sim_frame);
                        let mut e = s.gpu.device.create_command_encoder(&Default::default());
                        s.solver.encode_frame(&mut e, None);
                        s.gpu.queue.submit([e.finish()]);
                        s.sim_frame += 1;
                    }
                    s.solver.prepare_frame(&s.gpu.queue, s.sim_frame);
                    s.solver.encode_frame(&mut enc, None);
                    s.sim_frame += 1;
                }
                s.renderer.draw(&s.gpu.device, &s.gpu.queue, &mut enc, &view, s.config.width, s.config.height, &s.camera);
                s.gpu.queue.submit([enc.finish()]);
                s.gpu.queue.present(frame);
                s.frames += 1;
                let dt = s.fps_t0.elapsed().as_secs_f64();
                if dt >= 1.0 {
                    let fps = s.frames as f64 / dt;
                    let t = s.sim_frame as f32 * s.solver.cfg.frame_dt;
                    s.window.set_title(&format!("drape-spike (native) — {fps:.0} fps, sim t = {t:.1} s{}", if s.fast { ", FAST" } else { "" }));
                    log::info!("viewer: {fps:.1} fps, sim t = {t:.2} s, fast = {}", s.fast);
                    s.frames = 0;
                    s.fps_t0 = std::time::Instant::now();
                }
                s.window.request_redraw();
            }
            _ => {}
        }
    }
}
