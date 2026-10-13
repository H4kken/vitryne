// SPDX-License-Identifier: AGPL-3.0-or-later
//! Native entry point.
//!   drape [view]            winit viewer: drag on cloth = pull it, drag elsewhere = orbit,
//!                           wheel = zoom, space = pause, R = reset,
//!                           F = fast drape (8 sim frames per display frame)
//!   drape bench [--frames F] [--record-positions] [--out file.json]
//!                           headless benchmark, prints JSON
//!   drape bench-drag [--drag-seconds S] [--seed N] [--max-offset M] [--min-pull S] [--out file.json]
//!                           drape to rest, then scripted random drags (stability criterion)
//!   drape regress [--update] [--only NAME] [--dir tests/regression] [--toml]
//!                           the golden regression suite (examples/*.vtry, 10k, 600 frames);
//!                           exit 1 on any difference beyond tolerance, --update re-records,
//!                           --toml drapes the garment.toml sidecars instead (same goldens)
//!   drape export-web-assets <dir>
//!                           body OBJ + baked SDF (.bin) for the web pages
//!   drape frames --at 30,120,600 --out-dir DIR [--cam yaw,pitch,dist[,tx,ty,tz]]
//!                           headless: render the sim at those frames to PNGs
//!   drape info              print adapter report as JSON and exit
//!   drape snapshot <out>    M0 triangle smoke test, offscreen, PPM
//!
//!   drape pattern-svg <out.svg> [--edge E]
//!                           meshed T-shirt pattern with seams, for inspection
//!   drape garment-svg <out.svg> --garment G [--edge E | --verts N]
//!                           meshed garment with landmark numbers (node names for a .vtry)
//!   drape convert <garment.toml> <out.vtry | out.vtry/> [--include-dxf]
//!                           sidecar + DXF-AAMA -> project file (zip, or folder if the path
//!                           ends in / or is a folder); --include-dxf keeps the DXF in it
//!
//! Scene: --scene sheet|tshirt|garment (default sheet, or garment with --garment).
//!   garment: --garment G, a project file (.vtry/.vtryg, zip or folder) or a garment.toml;
//!            --verts N (target vertex count; default the file's targetVertices, or 10000)
//!            or --edge E. The SDF box comes from the file. A project file brings its avatar,
//!            fabric (friction included), camera and engine overrides; flags still win.
//!   sheet:  --grid N (vertices per side), --pin-spacing F, --no-sphere
//!   tshirt: --edge E (target edge length, m; 0.00864 ≈ 10k verts), --sdf-cell C (m)
//! Sim (any scene): --substeps S, --damping D, --friction MU, --stretch-damping BETA (s),
//! --contact-max-step M, --air-drag K (1/m).
//! `--gpu-timestamps` (any command): opt-in profiling mode, see `GpuOptions`.

use std::sync::Arc;

use drape_assets::{
    convert::ConvertOptions,
    garment::Garment as DxfGarment,
    project::{DEFAULT_TARGET_VERTICES, ProjectGarment, avatar_mesh},
    tshirt::{self, SdfParams, TshirtParams},
};
use drape_core::{
    body::{BodyMesh, BodyQuery, Sdf},
    engine::{Body, BodyOptions, Engine, Garment, SdfSource, Simulation},
    gpu,
    render::{self, OrbitCamera, Renderer},
    scene::SheetScene,
    sim::{DragPatch, SimSettings},
    timer::GpuTimer,
    triangle::TriangleRenderer,
};
use vitryne_format::{Document, Kind, glb};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{Key, NamedKey},
    window::{Window, WindowId},
};

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn"),
    )
    .init();
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let opts = gpu::GpuOptions {
        gpu_timestamps: take_flag(&mut args, "--gpu-timestamps"),
    };
    let scene_args = SceneArgs::take(&mut args);
    let headless_gpu = || {
        let instance = gpu::create_instance();
        pollster::block_on(gpu::Gpu::new(&instance, None, opts)).expect("gpu init")
    };
    match args.first().map(String::as_str).unwrap_or("view") {
        "view" => run_viewer(opts, scene_args.build(), scene_args.sim),
        "info" => println!(
            "{}",
            serde_json::to_string_pretty(&headless_gpu().report).unwrap()
        ),
        "bench" => {
            let engine = Engine::new(headless_gpu());
            let mut cfg = drape_core::bench::BenchConfig::default();
            if let Some(v) = take_value(&mut args, "--frames") {
                cfg.frames = v.parse().expect("--frames");
            }
            cfg.record_positions = take_flag(&mut args, "--record-positions");
            let out = take_value(&mut args, "--out");
            let scene = scene_args.build();
            let sim = engine.simulate(&scene.garment, &scene.body, &scene_args.sim);
            let r = pollster::block_on(drape_core::bench::run(&sim, cfg));
            let json = serde_json::to_string_pretty(&r).unwrap();
            if let Some(path) = out {
                std::fs::write(&path, &json).expect("write --out");
            }
            println!("{json}");
        }
        "bench-drag" => {
            let engine = Engine::new(headless_gpu());
            let mut cfg = drape_core::dragbench::DragBenchConfig::default();
            if let Some(v) = take_value(&mut args, "--drag-seconds") {
                cfg.drag_s = v.parse().expect("--drag-seconds");
            }
            if let Some(v) = take_value(&mut args, "--seed") {
                cfg.seed = v.parse().expect("--seed");
            }
            if let Some(v) = take_value(&mut args, "--max-offset") {
                cfg.max_offset = v.parse().expect("--max-offset");
            }
            if let Some(v) = take_value(&mut args, "--min-pull") {
                cfg.min_pull_s = v.parse().expect("--min-pull");
            }
            let out = take_value(&mut args, "--out");
            let scene = scene_args.build();
            let sim = engine.simulate(&scene.garment, &scene.body, &scene_args.sim);
            let r = pollster::block_on(drape_core::dragbench::run(&sim, cfg));
            let json = serde_json::to_string_pretty(&r).unwrap();
            if let Some(path) = out {
                std::fs::write(&path, &json).expect("write --out");
            }
            println!("{json}");
        }
        "regress" => {
            let update = take_flag(&mut args, "--update");
            let toml = take_flag(&mut args, "--toml");
            let only = take_value(&mut args, "--only");
            let dir = take_value(&mut args, "--dir").unwrap_or_else(|| "tests/regression".into());
            let engine = Engine::new(headless_gpu());
            if !regress(&engine, &dir, only.as_deref(), update, toml) {
                std::process::exit(1);
            }
        }
        "export-web-assets" => {
            let dir = args
                .get(1)
                .cloned()
                .unwrap_or_else(|| "web/public/assets".into());
            std::fs::create_dir_all(&dir).unwrap();
            let obj = std::fs::read_to_string(BODY_OBJ).expect("body obj");
            let body = BodyQuery::new(BodyMesh::from_obj(&obj).expect("parse body obj"));
            let sdf = load_or_bake_sdf(&body, &scene_args.sdf);
            std::fs::write(format!("{dir}/makehuman_body_m.obj"), &obj).unwrap();
            let name = format!(
                "{dir}/sdf_{}mm.bin",
                (scene_args.sdf.cell * 1000.0).round() as u32
            );
            std::fs::write(&name, sdf.to_bytes()).unwrap();
            println!(
                "wrote {dir}/makehuman_body_m.obj and {name} ({:.1} MB)",
                sdf.bytes() as f64 / 1e6
            );
            // Garments (S3): toml + DXF, and an SDF baked over each garment's own box.
            for e in std::fs::read_dir("assets/garments").expect("assets/garments") {
                let src = e.unwrap().path();
                let Ok(toml) = std::fs::read_to_string(src.join("garment.toml")) else {
                    continue;
                };
                let g = DxfGarment::load_file(src.join("garment.toml").to_str().unwrap())
                    .unwrap_or_else(|e| panic!("{e}"));
                let gname = src.file_name().unwrap().to_str().unwrap();
                let out = format!("{dir}/garments/{gname}");
                std::fs::create_dir_all(&out).unwrap();
                std::fs::write(format!("{out}/garment.toml"), &toml).unwrap();
                std::fs::copy(src.join(&g.spec.dxf), format!("{out}/garment.dxf")).unwrap();
                let gsdf = load_or_bake_sdf(&body, &g.sdf_params());
                std::fs::write(format!("{out}/sdf.bin"), gsdf.to_bytes()).unwrap();
                println!("wrote {out}/ (sdf {:.1} MB)", gsdf.bytes() as f64 / 1e6);
            }
        }
        "frames" => {
            let at: Vec<u32> = take_value(&mut args, "--at")
                .unwrap_or_else(|| "0,30,60,120,300,600".into())
                .split(',')
                .map(|s| s.parse().expect("--at"))
                .collect();
            let dir = take_value(&mut args, "--out-dir").unwrap_or_else(|| ".".into());
            // --cam yaw,pitch,distance[,tx,ty,tz] overrides the scene camera.
            let cam = take_value(&mut args, "--cam").map(|v| {
                v.split(',')
                    .map(|x| x.parse::<f32>().expect("--cam"))
                    .collect::<Vec<_>>()
            });
            let engine = Engine::new(headless_gpu());
            render_frames(
                &engine,
                &scene_args.build(),
                &scene_args.sim,
                &at,
                &dir,
                cam,
            );
        }
        "garment-svg" => {
            let out = args.get(1).cloned().unwrap_or_else(|| "garment.svg".into());
            let (gp, edge, name, report) = match &scene_args.project {
                Some(doc) => {
                    let pg = ProjectGarment::new(doc).unwrap_or_else(|e| panic!("{e}"));
                    let edge = scene_args.edge.unwrap_or_else(|| {
                        let verts = scene_args.verts.unwrap_or_else(|| pg.target_vertices());
                        pg.edge_for_vertices(verts)
                            .unwrap_or_else(|e| panic!("{e}"))
                    });
                    let gp = pg.pattern().unwrap_or_else(|e| panic!("{e}"));
                    (gp, edge, pg.garment.name.clone(), "{}".to_string())
                }
                None => {
                    let g = scene_args.garment();
                    let edge = scene_args.garment_edge(&g);
                    let gp = g.pattern().unwrap_or_else(|e| panic!("{e}"));
                    let report = serde_json::to_string(&g.report).unwrap();
                    (gp, edge, g.spec.name.clone(), report)
                }
            };
            let mp = drape_assets::meshing::mesh_pattern(&gp.pattern, edge);
            let title = format!("{name} (edge {:.1} mm)", edge * 1000.0);
            std::fs::write(
                &out,
                drape_assets::preview::pattern_svg(&gp.pattern, &mp, &gp.labels, &title),
            )
            .expect("write svg");
            println!(
                "wrote {out}: {} vertices; import: {report}",
                mp.mesh.n_verts()
            );
        }
        "convert" => {
            let include_dxf = take_flag(&mut args, "--include-dxf");
            let (Some(src), Some(out)) = (args.get(1), args.get(2)) else {
                eprintln!(
                    "usage: drape convert <garment.toml> <out.vtry | out.vtry/> [--include-dxf]"
                );
                std::process::exit(2);
            };
            convert(src, out, include_dxf);
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
            eprintln!(
                "unknown command '{other}' (view | bench | bench-drag | regress | frames | export-web-assets | convert | garment-svg | pattern-svg | info | snapshot)"
            );
            std::process::exit(2);
        }
    }
}

struct SceneArgs {
    kind: String,
    sheet: SheetScene,
    tshirt: TshirtParams,
    sdf: SdfParams,
    sim: drape_core::sim::SimSettings,
    garment: Option<String>,
    /// The project file `--garment` names, opened.
    project: Option<Arc<Document>>,
    verts: Option<u32>,
    edge: Option<f32>,
}

impl SceneArgs {
    fn take(args: &mut Vec<String>) -> Self {
        let garment = take_value(args, "--garment");
        let project = garment
            .as_deref()
            .filter(|p| is_project_file(p))
            .map(|p| Arc::new(open_project(p)));
        let mut a = Self {
            kind: take_value(args, "--scene").unwrap_or_else(|| {
                if garment.is_some() {
                    "garment"
                } else {
                    "sheet"
                }
                .into()
            }),
            sheet: SheetScene::default(),
            tshirt: TshirtParams::default(),
            sdf: SdfParams::default(),
            sim: SheetScene::config(),
            garment,
            project,
            verts: None,
            edge: None,
        };
        // The file's settings first (fabric friction, engine overrides), so flags win.
        if let Some(doc) = &a.project {
            let pg = ProjectGarment::new(doc).unwrap_or_else(|e| panic!("{e}"));
            for w in pg.apply_settings(&mut a.sim) {
                log::warn!("{w}");
            }
        }
        if let Some(v) = take_value(args, "--verts") {
            a.verts = Some(v.parse().expect("--verts"));
        }
        let num = |args: &mut Vec<String>, flag: &str| {
            take_value(args, flag).map(|v| v.parse::<f32>().unwrap_or_else(|_| panic!("{flag}")))
        };
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
            a.edge = Some(v);
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
        if let Some(v) = num(args, "--stretch-damping") {
            a.sim.stretch_damping = v;
        }
        if let Some(v) = num(args, "--air-drag") {
            a.sim.air_drag = v;
        }
        if let Some(v) = num(args, "--contact-max-step") {
            a.sim.contact_max_step = v;
        }
        if let Some(v) = num(args, "--contact-max-accel") {
            a.sim.contact_max_accel = v;
        }
        if let Some(v) = num(args, "--contact-vfriction") {
            a.sim.contact_vfriction = v;
        }
        if take_flag(args, "--no-pins") {
            a.sheet.pins = false;
        }
        if take_flag(args, "--self-collision") {
            a.sim.self_collision = true;
        }
        if let Some(v) = num(args, "--self-radius") {
            a.sim.self_radius_edges = v;
        }
        if let Some(v) = num(args, "--self-exclude") {
            a.sim.self_exclude_radii = v;
        }
        if let Some(v) = num(args, "--self-friction") {
            a.sim.self_friction = v;
        }
        if let Some(v) = take_value(args, "--self-rebuild") {
            a.sim.self_rebuild_every = v.parse().expect("--self-rebuild");
        }
        if let Some(v) = num(args, "--self-push-speed") {
            a.sim.self_max_push_speed = v;
        }
        if let Some(v) = num(args, "--self-margin") {
            a.sim.self_margin_radii = v;
        }
        if let Some(v) = take_value(args, "--untangle-every") {
            a.sim.untangle_every = v.parse().expect("--untangle-every");
        }
        if let Some(v) = take_value(args, "--untangle-check-every") {
            a.sim.untangle_check_every = v.parse().expect("--untangle-check-every");
        }
        if let Some(v) = num(args, "--untangle-step") {
            a.sim.untangle_step_edges = v;
        }
        if let Some(v) = num(args, "--untangle-max-ratio") {
            a.sim.untangle_max_ratio = v;
        }
        if let Some(v) = num(args, "--gravity-scale") {
            a.sim.gravity = a.sim.gravity.map(|g| g * v);
        }
        if let Some(v) = take_value(args, "--long-range") {
            // Comma-separated spans in edges, e.g. 4,16,64 ("0" = off).
            a.sim.long_range_spans = [0.0; 4];
            for (k, x) in v.split(',').take(4).enumerate() {
                a.sim.long_range_spans[k] = x.parse().expect("--long-range");
            }
        }
        if let Some(v) = take_value(args, "--stretch-iterations") {
            a.sim.stretch_iterations = v.parse().expect("--stretch-iterations");
        }
        if let Some(v) = take_value(args, "--long-range-cross") {
            a.sim.long_range_cross_spans = [0.0; 4];
            for (k, x) in v.split(',').take(4).enumerate() {
                a.sim.long_range_cross_spans[k] = x.parse().expect("--long-range-cross");
            }
        }
        if let Some(v) = take_value(args, "--long-range-iterations") {
            a.sim.long_range_iterations = v.parse().expect("--long-range-iterations");
        }
        if let Some(v) = take_value(args, "--long-range-every") {
            a.sim.long_range_every = v.parse().expect("--long-range-every");
        }
        if let Some(v) = num(args, "--long-range-omega") {
            a.sim.long_range_omega = v;
        }
        if let Some(v) = take_value(args, "--long-range-slot") {
            a.sim.long_range_slot = v.parse().expect("--long-range-slot");
        }
        if let Some(v) = num(args, "--strain-limit") {
            a.sim.strain_limit = v;
        }
        if let Some(v) = num(args, "--long-range-damping") {
            a.sim.long_range_damping = v;
        }
        if let Some(v) = num(args, "--long-range-slack") {
            a.sim.long_range_slack = v;
        }
        if take_flag(args, "--untangle-keep-repulsion") {
            a.sim.untangle_skip_repulsion = false;
        }
        a
    }

    /// Loads the scene: the garment (meshed and placed) and the body it falls on. CPU only.
    fn build(&self) -> Scene {
        let load = |e: String| -> ! { panic!("{e}") };
        let read_obj =
            || std::fs::read_to_string(BODY_OBJ).unwrap_or_else(|e| panic!("{BODY_OBJ}: {e}"));
        let test_avatar =
            || BodyMesh::from_obj(&read_obj()).unwrap_or_else(|e| panic!("{BODY_OBJ}: {e}"));
        let (desc, fabric, body) = match self.kind.as_str() {
            "sheet" => (
                self.sheet.garment(),
                self.sheet.fabric(),
                Body::sphere(self.sheet.sphere().0, self.sheet.sphere().1),
            ),
            "tshirt" => {
                let desc = tshirt::build(&self.tshirt);
                let body = load_body_cached("makehuman", test_avatar(), &self.sdf);
                (desc, tshirt::fabric(), body)
            }
            "garment" if self.project.is_some() => {
                let doc = self.project.as_ref().unwrap();
                let pg = ProjectGarment::new(doc).unwrap_or_else(|e| load(e));
                for w in &pg.warnings {
                    log::warn!("{w}");
                }
                let edge = self.edge.unwrap_or_else(|| {
                    let verts = self.verts.unwrap_or_else(|| pg.target_vertices());
                    pg.edge_for_vertices(verts).unwrap_or_else(|e| load(e))
                });
                let desc = pg.build(edge).unwrap_or_else(|e| load(e));
                let mut sdf_params = desc.sdf.clone();
                if self.sdf.cell != SdfParams::default().cell {
                    sdf_params.cell = self.sdf.cell;
                }
                let body = match avatar_mesh(doc).unwrap_or_else(|e| load(e)) {
                    Some(mesh) => {
                        let name = &doc.project_avatar().unwrap().name;
                        load_body_cached(name, mesh, &sdf_params)
                    }
                    None => load_body_cached("makehuman", test_avatar(), &sdf_params),
                };
                (desc, pg.material(), body)
            }
            "garment" => {
                let g = self.garment();
                let edge = self.garment_edge(&g);
                let mut sdf_params = g.sdf_params();
                if self.sdf.cell != SdfParams::default().cell {
                    sdf_params.cell = self.sdf.cell;
                }
                let desc = g.build(edge).unwrap_or_else(|e| load(e));
                let body = load_body_cached("makehuman", test_avatar(), &sdf_params);
                (desc, g.fabric(), body)
            }
            other => panic!("unknown --scene {other} (sheet | tshirt | garment)"),
        };
        let garment = Garment::load(&desc, &fabric).unwrap_or_else(|e| load(e));
        Scene {
            garment: Arc::new(garment),
            body: Arc::new(body),
        }
    }

    fn garment(&self) -> DxfGarment {
        let path = self
            .garment
            .as_deref()
            .expect("--garment path/garment.toml");
        DxfGarment::load_file(path).unwrap_or_else(|e| panic!("{e}"))
    }

    fn garment_edge(&self, g: &DxfGarment) -> f32 {
        self.edge.unwrap_or_else(|| {
            g.edge_for_vertices(self.verts.unwrap_or(DEFAULT_TARGET_VERTICES))
                .unwrap_or_else(|e| panic!("{e}"))
        })
    }
}

/// A project file (zip or folder) rather than a garment.toml.
fn is_project_file(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.join("manifest.json").is_file()
        || Kind::ALL
            .iter()
            .any(|k| path.trim_end_matches('/').ends_with(k.extension()))
}

fn open_project(path: &str) -> Document {
    let opened =
        Document::open(std::path::Path::new(path)).unwrap_or_else(|e| panic!("{path}: {e}"));
    for w in &opened.warnings {
        log::warn!("{path}: {w}");
    }
    opened.doc
}

/// `drape convert`: a garment.toml and its DXF to a project file, with the test avatar.
fn convert(src: &str, out: &str, include_dxf: bool) {
    let g = DxfGarment::load_file(src).unwrap_or_else(|e| panic!("{e}"));
    let dxf_path = std::path::Path::new(src)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join(&g.spec.dxf);
    let body = BodyMesh::from_obj(&std::fs::read_to_string(BODY_OBJ).expect("body obj"))
        .expect("parse body obj");
    let mesh = glb::Mesh {
        positions: body.pos.iter().map(|p| p.to_array()).collect(),
        indices: body.tris.iter().flatten().copied().collect(),
    };
    let opts = ConvertOptions {
        body_glb: glb::write(&mesh, vitryne_format::GENERATOR),
        dxf_file_name: dxf_path.file_name().unwrap().to_string_lossy().into_owned(),
        include_dxf: include_dxf.then(|| std::fs::read(&dxf_path).expect("read dxf")),
    };
    let mut doc =
        drape_assets::convert::convert(&g, &opts).unwrap_or_else(|e| panic!("{src}: {e}"));
    doc.generator = Some(format!("drape convert ({})", vitryne_format::GENERATOR));
    let folder = out.ends_with('/') || std::path::Path::new(out).is_dir();
    let r = if folder {
        doc.save_folder(std::path::Path::new(out))
    } else {
        doc.save(std::path::Path::new(out))
    };
    r.unwrap_or_else(|e| panic!("{out}: {e}"));
    let g = &doc.garments[0];
    println!(
        "wrote {out}: {} pieces, {} cuts, {} seams, {} nodes{}",
        g.pieces.len(),
        g.cuts().count(),
        g.seams.len(),
        g.pieces.iter().map(|p| p.outline.len()).sum::<usize>(),
        if include_dxf { ", DXF kept" } else { "" }
    );
}

const BODY_OBJ: &str = "assets/body/makehuman_body_m.obj";

/// Where a baked SDF is cached: target/sdf-cache/, keyed by the body mesh and the SDF
/// parameters (so the OBJ and a project's glTF of the same mesh share one bake).
fn sdf_cache_path(mesh: &BodyMesh, p: &SdfParams) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let params = serde_json::to_string(p).unwrap();
    let bytes = mesh
        .pos
        .iter()
        .flat_map(|v| v.to_array())
        .flat_map(f32::to_le_bytes)
        .chain(mesh.tris.iter().flatten().flat_map(|i| i.to_le_bytes()))
        .chain(params.bytes());
    for b in bytes {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("target/sdf-cache/{h:016x}.bin")
}

/// The bake takes seconds, so cache it under target/ keyed by body + SDF parameters.
fn load_or_bake_sdf(body: &BodyQuery, p: &SdfParams) -> Sdf {
    let path = sdf_cache_path(&body.mesh, p);
    if let Ok(bytes) = std::fs::read(&path)
        && let Some(sdf) = Sdf::from_bytes(&bytes)
    {
        log::info!("SDF: loaded {path}");
        return sdf;
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

/// The avatar with its SDF, from the cache under target/ when it has been baked before.
fn load_body_cached(name: &str, mesh: BodyMesh, p: &SdfParams) -> Body {
    let t0 = std::time::Instant::now();
    let path = sdf_cache_path(&mesh, p);
    let cached = std::fs::read(&path)
        .ok()
        .filter(|b| Sdf::from_bytes(b).is_some());
    let from_cache = cached.is_some();
    let opts = BodyOptions {
        sdf: match cached {
            Some(bytes) => SdfSource::Bytes(bytes),
            None => SdfSource::Bake(p.clone()),
        },
    };
    let body = Body::from_mesh(name, mesh, &opts).unwrap_or_else(|e| panic!("{e}"));
    if !from_cache {
        let _ = std::fs::create_dir_all("target/sdf-cache");
        let _ = std::fs::write(&path, body.sdf().expect("avatar SDF").to_bytes());
    }
    log::info!(
        "body + SDF {} in {:.2} s",
        if from_cache {
            format!("loaded {path}")
        } else {
            "baked".into()
        },
        t0.elapsed().as_secs_f64()
    );
    body
}

/// What a scene is made of, ready to simulate.
struct Scene {
    garment: Arc<Garment>,
    body: Arc<Body>,
}

/// The golden cases: (name, project file, the garment.toml it was converted from, golden shape
/// tolerance mm, persistent self-intersection slack, note). Both paths must match one golden. The hoodie never rests and its neck junction is chaotic
/// (native vs Chrome differ by up to 11 mm at the end, PROGRESS.md M2), so its shape tolerance
/// is wide and its intersection count has headroom; it still catches a real change.
const REGRESSION_CASES: [(&str, &str, &str, f32, f32, &str); 3] = [
    (
        "tshirt",
        "examples/tshirt.vtry",
        "assets/garments/tshirt/garment.toml",
        0.5,
        0.0,
        "FreeSewing Teagan at chest ease 18%, knit jersey, 10k vertices, self-collision.",
    ),
    (
        "trousers",
        "examples/trousers.vtry",
        "assets/garments/trousers/garment.toml",
        0.5,
        0.0,
        "FreeSewing Titan, twill (woven), 10k vertices, self-collision.",
    ),
    (
        "hoodie",
        "examples/hoodie.vtry",
        "assets/garments/hoodie/garment.toml",
        20.0,
        0.25,
        "FreeSewing Hugo, known weaknesses recorded on purpose: never rests, ~136 persistent \
         self-intersections at the hood junction, seam gap ~34 mm (PROGRESS.md M2). A fix \
         will show up here as a difference to re-record.",
    ),
];

/// Runs (or, with `update`, records) the cases. Returns true if everything passed.
fn regress(engine: &Engine, dir: &str, only: Option<&str>, update: bool, toml: bool) -> bool {
    use drape_core::regress::{
        Golden, observe, positions_from_bytes, positions_to_bytes, shape_diff_mm,
    };
    std::fs::create_dir_all(dir).expect("regression dir");
    let mut all_ok = true;
    for (name, project, sidecar, shape_tol, slack, note) in REGRESSION_CASES {
        if only.is_some_and(|o| o != name) {
            continue;
        }
        let mut a: Vec<String> = [
            "--scene",
            "garment",
            "--garment",
            if toml { sidecar } else { project },
            "--verts",
            "10000",
            "--self-collision",
            "--self-rebuild",
            "4",
        ]
        .map(String::from)
        .into();
        let args = SceneArgs::take(&mut a);
        let scene = args.build();
        let sim = engine.simulate(&scene.garment, &scene.body, &args.sim);
        let t0 = std::time::Instant::now();
        let (now, pos) = pollster::block_on(observe(&sim));
        let json_path = format!("{dir}/{name}.json");
        let pos_path = format!("{dir}/{name}.pos");
        if update {
            let mut g = Golden::new(
                note,
                now.clone(),
                serde_json::to_value(args.sim).expect("settings"),
            );
            g.shape_tolerance_mm = shape_tol;
            g.intersection_slack = slack;
            std::fs::write(&json_path, serde_json::to_string_pretty(&g).unwrap() + "\n")
                .expect("write golden");
            std::fs::write(&pos_path, positions_to_bytes(&pos)).expect("write golden shape");
            println!("{name}: recorded {json_path} and {pos_path}");
            continue;
        }
        let g: Golden = match std::fs::read_to_string(&json_path) {
            Ok(t) => serde_json::from_str(&t).unwrap_or_else(|e| panic!("{json_path}: {e}")),
            Err(e) => {
                println!(
                    "{name}: FAIL: no golden ({json_path}: {e}); run `drape regress --update`"
                );
                all_ok = false;
                continue;
            }
        };
        let shape = std::fs::read(&pos_path)
            .ok()
            .map(|b| positions_from_bytes(&b))
            .filter(|p| p.len() == pos.len())
            .map(|p| shape_diff_mm(&p, &pos));
        let mut bad = g.check(&now, shape);
        if shape.is_none() {
            bad.push(format!("no usable golden shape ({pos_path})"));
        }
        let rest = now.rest_frame.map_or("none".into(), |r| r.to_string());
        if bad.is_empty() {
            println!(
                "{name}: ok  rest {rest}, penetration {:.2} mm, persistent self-intersections {}, strain p99 {:.1}%, shape {:.2} mm ({:.0} s)",
                now.max_penetration_mm,
                now.persistent_pairs,
                now.strain_p99 * 100.0,
                shape.unwrap_or(0.0),
                t0.elapsed().as_secs_f64()
            );
        } else {
            all_ok = false;
            println!("{name}: FAIL");
            for b in bad {
                println!("    {b}");
            }
        }
    }
    all_ok
}

fn pattern_svg(out: &str, edge: f32) {
    let pat = tshirt::pattern();
    let mp = drape_assets::meshing::mesh_pattern(&pat, edge);
    std::fs::write(
        out,
        drape_assets::preview::pattern_svg(
            &pat,
            &mp,
            &[],
            &format!("procedural T-shirt, edge {:.1} mm", edge * 1000.0),
        ),
    )
    .expect("write svg");
    println!("wrote {out}: {} vertices", mp.mesh.n_verts());
}

fn take_value(args: &mut Vec<String>, flag: &str) -> Option<String> {
    let i = args.iter().position(|a| a == flag)?;
    let v = args
        .get(i + 1)
        .cloned()
        .unwrap_or_else(|| panic!("{flag} needs a value"));
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
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
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
        Self {
            tex,
            view,
            readback,
            w,
            h,
        }
    }

    fn copy(&self, enc: &mut wgpu::CommandEncoder) {
        enc.copy_texture_to_buffer(
            self.tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &self.readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(self.w * 4),
                    rows_per_image: Some(self.h),
                },
            },
            wgpu::Extent3d {
                width: self.w,
                height: self.h,
                depth_or_array_layers: 1,
            },
        );
    }

    fn read(&self, device: &wgpu::Device) -> Vec<u8> {
        pollster::block_on(drape_core::gpu_async::read_buffer::<u8>(
            device,
            &self.readback,
        ))
    }
}

fn write_png(path: &str, w: u32, h: u32, rgba: &[u8]) {
    let file = std::io::BufWriter::new(std::fs::File::create(path).expect("create png"));
    let mut enc = png::Encoder::new(file, w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(rgba).unwrap();
}

fn render_frames(
    engine: &Engine,
    scene: &Scene,
    settings: &SimSettings,
    at: &[u32],
    dir: &str,
    cam: Option<Vec<f32>>,
) {
    std::fs::create_dir_all(dir).unwrap();
    let g = engine.gpu();
    let sim = engine.simulate(&scene.garment, &scene.body, settings);
    let off = Offscreen::new(&g.device, 1024, 768);
    let mut renderer = Renderer::new(
        &g.device,
        Offscreen::FORMAT,
        scene.garment.mesh(),
        sim.solver(),
        &scene.body.render,
    );
    let (cam_target, cam_distance) = scene.garment.desc.camera;
    let mut camera = OrbitCamera::looking_at(cam_target, cam_distance);
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
            renderer.draw(
                &g.device, &g.queue, &mut enc, &off.view, off.w, off.h, &camera,
            );
            off.copy(&mut enc);
            g.queue.submit([enc.finish()]);
            let px = off.read(&g.device);
            let path = format!("{dir}/frame{f:04}.png");
            write_png(&path, off.w, off.h, &px);
            println!("wrote {path}");
        }
        sim.step(1);
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
    for px in data.as_chunks::<4>().0 {
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
    scene: Scene,
    settings: SimSettings,
    state: Option<ViewerState>,
}

struct ViewerState {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    engine: Engine,
    sim: Simulation,
    renderer: Renderer,
    camera: OrbitCamera,
    dragging: bool,
    /// Anchor point of the grabbed patch (drag plane passes through it).
    pulling: Option<glam::Vec3>,
    last_cursor: Option<(f64, f64)>,
    paused: bool,
    fast: bool,
    frames: u32,
    fps_t0: std::time::Instant,
}

impl ViewerState {
    fn mouse_ray(&self, x: f64, y: f64) -> (glam::Vec3, glam::Vec3) {
        let (w, h) = (self.config.width as f32, self.config.height as f32);
        self.camera
            .ray(2.0 * x as f32 / w - 1.0, 1.0 - 2.0 * y as f32 / h, w / h)
    }
}

fn run_viewer(opts: gpu::GpuOptions, scene: Scene, settings: SimSettings) {
    let event_loop = EventLoop::new().expect("event loop");
    let mut app = Viewer {
        instance: gpu::create_instance(),
        opts,
        scene,
        settings,
        state: None,
    };
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
        let surface = self
            .instance
            .create_surface(window.clone())
            .expect("surface");
        let gpu = pollster::block_on(gpu::Gpu::new(&self.instance, Some(&surface), self.opts))
            .expect("gpu init");
        let size = window.inner_size();
        let config = surface
            .get_default_config(&gpu.adapter, size.width.max(1), size.height.max(1))
            .expect("surface unsupported by adapter");
        surface.configure(&gpu.device, &config);
        let engine = Engine::new(gpu);
        let sim = engine.simulate(&self.scene.garment, &self.scene.body, &self.settings);
        let renderer = Renderer::new(
            &engine.gpu().device,
            config.format,
            self.scene.garment.mesh(),
            sim.solver(),
            &self.scene.body.render,
        );
        log::info!(
            "scene: {} verts, {} stretch colours, {} bend colours, {} dispatches/frame",
            self.scene.garment.mesh().n_verts(),
            self.scene.garment.constraints.stretch.n_colors(),
            self.scene.garment.constraints.bend.n_colors(),
            sim.solver().dispatches_per_frame()
        );
        let (cam_target, cam_distance) = self.scene.garment.desc.camera;
        window.request_redraw();
        self.state = Some(ViewerState {
            window,
            surface,
            config,
            engine,
            sim,
            renderer,
            camera: OrbitCamera::looking_at(cam_target, cam_distance),
            dragging: false,
            pulling: None,
            last_cursor: None,
            paused: false,
            fast: false,
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
                s.surface.configure(&s.engine.gpu().device, &s.config);
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Left,
                ..
            } => {
                if state == ElementState::Pressed {
                    // Pick on the CPU from a one-off position readback (not per frame).
                    if let Some((x, y)) = s.last_cursor {
                        let (o, d) = s.mouse_ray(x, y);
                        let pos = pollster::block_on(s.sim.read_positions());
                        if let Some(v) = render::pick(&pos, o, d, 0.015) {
                            let patch = DragPatch::grab(
                                s.sim.adjacency(),
                                &pos,
                                v,
                                s.sim.settings().drag_radius,
                            );
                            s.sim.grab_patch(&patch, pos[v as usize]);
                            s.pulling = Some(pos[v as usize]);
                        }
                    }
                    s.dragging = s.pulling.is_none();
                } else {
                    s.dragging = false;
                    s.pulling = None;
                    s.sim.release();
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                if let (true, Some((x, y))) = (s.dragging, s.last_cursor) {
                    s.camera
                        .orbit((position.x - x) as f32, (position.y - y) as f32);
                }
                if let Some(anchor) = s.pulling {
                    let (o, d) = s.mouse_ray(position.x, position.y);
                    s.sim
                        .set_target(render::drag_target(&s.camera, o, d, anchor));
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
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                match event.logical_key {
                    Key::Named(NamedKey::Space) => s.paused = !s.paused,
                    Key::Character(c) if c.eq_ignore_ascii_case("f") => s.fast = !s.fast,
                    Key::Character(c) if c.eq_ignore_ascii_case("r") => {
                        s.sim.reset();
                    }
                    _ => {}
                }
            }
            WindowEvent::RedrawRequested => {
                let gpu = s.engine.gpu_handle();
                let frame = match s.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(f)
                    | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
                    _ => {
                        s.surface.configure(&gpu.device, &s.config);
                        s.window.request_redraw();
                        return;
                    }
                };
                let view = frame.texture.create_view(&Default::default());
                let mut enc = gpu.device.create_command_encoder(&Default::default());
                if !s.paused {
                    // Each sim frame gets its own submit: params are written per sim frame,
                    // and queue writes apply at submit, not at their position in an encoder.
                    if s.fast {
                        s.sim.step(7);
                    }
                    s.sim.encode_step(&mut enc, None);
                }
                s.renderer.draw(
                    &gpu.device,
                    &gpu.queue,
                    &mut enc,
                    &view,
                    s.config.width,
                    s.config.height,
                    &s.camera,
                );
                gpu.queue.submit([enc.finish()]);
                gpu.queue.present(frame);
                s.frames += 1;
                let dt = s.fps_t0.elapsed().as_secs_f64();
                if dt >= 1.0 {
                    let fps = s.frames as f64 / dt;
                    let t = s.sim.time();
                    s.window.set_title(&format!(
                        "drape-spike (native) — {fps:.0} fps, sim t = {t:.1} s{}",
                        if s.fast { ", FAST" } else { "" }
                    ));
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
