//! Drape spike core: GPU device setup, solver, metrics.

#[cfg(not(target_arch = "wasm32"))]
pub mod attrib;
pub mod bench;
pub mod body;
pub mod constraints;
pub mod dragbench;
pub mod gpu;
pub mod gpu_async;
pub mod mesh;
pub mod metrics;
pub mod render;
pub mod scene;
pub mod selfcol;
pub mod selfcheck;
pub mod sim;
pub mod timer;
pub mod triangle;
