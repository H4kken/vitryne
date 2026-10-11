//! Native entry point.
//!   drape [view]           winit window with the M0 triangle
//!   drape info             print adapter report as JSON and exit
//!   drape snapshot <out>   render the triangle offscreen and write a PPM (headless check)

use std::sync::Arc;

use drape_core::{gpu, triangle::TriangleRenderer};
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn")).init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str).unwrap_or("view") {
        "view" => run_viewer(),
        "info" => {
            let instance = gpu::create_instance();
            let g = pollster::block_on(gpu::Gpu::new(&instance, None)).expect("gpu init");
            println!("{}", serde_json::to_string_pretty(&g.report).unwrap());
        }
        "snapshot" => {
            let out = args.get(1).map(String::as_str).unwrap_or("triangle.ppm");
            snapshot(out);
        }
        other => {
            eprintln!("unknown command '{other}' (expected view | info | snapshot <out.ppm>)");
            std::process::exit(2);
        }
    }
}

fn snapshot(out: &str) {
    let instance = gpu::create_instance();
    let g = pollster::block_on(gpu::Gpu::new(&instance, None)).expect("gpu init");
    let (w, h) = (256u32, 256u32);
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let tex = g.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("snapshot"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&Default::default());
    let bytes_per_row = w * 4; // 1024, already 256-aligned
    let readback = g.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("snapshot-readback"),
        size: (bytes_per_row * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let renderer = TriangleRenderer::new(&g.device, format);
    let mut enc = g.device.create_command_encoder(&Default::default());
    renderer.draw(&mut enc, &view);
    enc.copy_texture_to_buffer(
        tex.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row), rows_per_image: Some(h) },
        },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    g.queue.submit([enc.finish()]);
    let slice = readback.slice(..);
    slice.map_async(wgpu::MapMode::Read, |r| r.expect("map failed"));
    g.device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
    let data = slice.get_mapped_range().expect("mapped range");
    let mut ppm = format!("P6\n{w} {h}\n255\n").into_bytes();
    for px in data.chunks_exact(4) {
        ppm.extend_from_slice(&px[..3]);
    }
    std::fs::write(out, ppm).expect("write ppm");
    // Centre pixel should be inside the triangle (not the clear colour).
    let c = ((h / 2 * w + w / 2) * 4) as usize;
    println!("wrote {out}; centre pixel rgb = {:?}", &data[c..c + 3]);
}

struct Viewer {
    instance: wgpu::Instance,
    state: Option<ViewerState>,
}

struct ViewerState {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    gpu: gpu::Gpu,
    renderer: TriangleRenderer,
}

fn run_viewer() {
    let event_loop = EventLoop::new().expect("event loop");
    let mut app = Viewer { instance: gpu::create_instance(), state: None };
    event_loop.run_app(&mut app).expect("run");
}

impl ApplicationHandler for Viewer {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        let window = Arc::new(
            el.create_window(Window::default_attributes().with_title("drape-spike (native)"))
                .expect("window"),
        );
        let surface = self.instance.create_surface(window.clone()).expect("surface");
        let gpu = pollster::block_on(gpu::Gpu::new(&self.instance, Some(&surface))).expect("gpu init");
        let size = window.inner_size();
        let config = surface
            .get_default_config(&gpu.adapter, size.width.max(1), size.height.max(1))
            .expect("surface unsupported by adapter");
        surface.configure(&gpu.device, &config);
        let renderer = TriangleRenderer::new(&gpu.device, config.format);
        window.request_redraw();
        self.state = Some(ViewerState { window, surface, config, gpu, renderer });
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(s) = self.state.as_mut() else { return };
        match event {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                s.config.width = size.width.max(1);
                s.config.height = size.height.max(1);
                s.surface.configure(&s.gpu.device, &s.config);
                s.window.request_redraw();
            }
            WindowEvent::RedrawRequested => {
                let frame = match s.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
                    _ => {
                        s.surface.configure(&s.gpu.device, &s.config);
                        return;
                    }
                };
                let view = frame.texture.create_view(&Default::default());
                let mut enc = s.gpu.device.create_command_encoder(&Default::default());
                s.renderer.draw(&mut enc, &view);
                s.gpu.queue.submit([enc.finish()]);
                s.gpu.queue.present(frame);
            }
            _ => {}
        }
    }
}
