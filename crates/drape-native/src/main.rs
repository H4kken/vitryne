//! Native entry point.
//!   drape [view]            winit viewer: M1 sheet on a sphere (drag = orbit, wheel = zoom,
//!                           space = pause, R = reset)
//!   drape bench [--frames F] [--out file.json]
//!                           headless benchmark, prints JSON
//!   drape frames --at 30,120,600 --out-dir DIR
//!                           headless: render the sim at those frames to PNGs
//!   drape info              print adapter report as JSON and exit
//!   drape snapshot <out>    M0 triangle smoke test, offscreen, PPM
//!
//! Scene options (any sim command): --grid N (vertices per side), --substeps S, --damping D,
//! --friction MU, --pin-spacing F, --no-sphere.
//! `--gpu-timestamps` (any command): opt-in profiling mode, see `GpuOptions`.

use std::sync::Arc;

use drape_core::{
    gpu,
    render::{OrbitCamera, Renderer},
    scene::SheetScene,
    sim::{SimConfig, Solver},
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
    let mut scene = SheetScene::default();
    let mut sim = SheetScene::config();
    if let Some(v) = take_value(&mut args, "--grid") {
        scene.grid = v.parse().expect("--grid");
    }
    if let Some(v) = take_value(&mut args, "--substeps") {
        sim.substeps = v.parse().expect("--substeps");
    }
    if let Some(v) = take_value(&mut args, "--damping") {
        sim.damping = v.parse().expect("--damping");
    }
    if let Some(v) = take_value(&mut args, "--friction") {
        sim.friction = v.parse().expect("--friction");
    }
    if let Some(v) = take_value(&mut args, "--pin-spacing") {
        scene.pin_spacing = v.parse().expect("--pin-spacing");
    }
    if take_flag(&mut args, "--no-sphere") {
        scene.sphere_center = [0.0, -100.0, 0.0];
    }
    let headless_gpu = || {
        let instance = gpu::create_instance();
        pollster::block_on(gpu::Gpu::new(&instance, None, opts)).expect("gpu init")
    };
    match args.first().map(String::as_str).unwrap_or("view") {
        "view" => run_viewer(opts, scene, sim),
        "info" => println!("{}", serde_json::to_string_pretty(&headless_gpu().report).unwrap()),
        "bench" => {
            let g = headless_gpu();
            let mut cfg = drape_core::bench::BenchConfig { scene, sim, ..Default::default() };
            if let Some(v) = take_value(&mut args, "--frames") {
                cfg.frames = v.parse().expect("--frames");
            }
            let out = take_value(&mut args, "--out");
            let r = pollster::block_on(drape_core::bench::run(&g, cfg));
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
            render_frames(&headless_gpu(), scene, sim, &at, &dir);
        }
        "snapshot" => {
            let out = args.get(1).map(String::as_str).unwrap_or("triangle.ppm");
            snapshot(&headless_gpu(), out);
        }
        other => {
            eprintln!("unknown command '{other}' (view | bench | frames | info | snapshot)");
            std::process::exit(2);
        }
    }
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

fn render_frames(g: &gpu::Gpu, scene: SheetScene, sim: SimConfig, at: &[u32], dir: &str) {
    std::fs::create_dir_all(dir).unwrap();
    let built = scene.build();
    let solver = Solver::new(&g.device, &built.mesh, &built.constraints, built.material.density, sim, built.sphere);
    let off = Offscreen::new(&g.device, 1024, 768);
    let mut renderer = Renderer::new(&g.device, Offscreen::FORMAT, &built.mesh, &solver);
    let camera = OrbitCamera::default();
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
    scene: SheetScene,
    sim: SimConfig,
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
    frames: u32,
    fps_t0: std::time::Instant,
}

fn run_viewer(opts: gpu::GpuOptions, scene: SheetScene, sim: SimConfig) {
    let event_loop = EventLoop::new().expect("event loop");
    let mut app = Viewer { instance: gpu::create_instance(), opts, scene, sim, state: None };
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
        let built = self.scene.build();
        let solver = Solver::new(&gpu.device, &built.mesh, &built.constraints, built.material.density, self.sim, built.sphere);
        let renderer = Renderer::new(&gpu.device, config.format, &built.mesh, &solver);
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
            camera: OrbitCamera::default(),
            dragging: false,
            last_cursor: None,
            paused: false,
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
                Key::Character(c) if c.eq_ignore_ascii_case("r") => s.solver.reset(&s.gpu.queue),
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
                    s.solver.encode_frame(&mut enc, None);
                }
                s.renderer.draw(&s.gpu.device, &s.gpu.queue, &mut enc, &view, s.config.width, s.config.height, &s.camera);
                s.gpu.queue.submit([enc.finish()]);
                s.gpu.queue.present(frame);
                s.frames += 1;
                let dt = s.fps_t0.elapsed().as_secs_f64();
                if dt >= 1.0 {
                    let fps = s.frames as f64 / dt;
                    s.window.set_title(&format!("drape-spike (native) — {fps:.0} fps"));
                    log::info!("viewer: {fps:.1} fps");
                    s.frames = 0;
                    s.fps_t0 = std::time::Instant::now();
                }
                s.window.request_redraw();
            }
            _ => {}
        }
    }
}
