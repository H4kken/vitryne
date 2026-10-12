// SPDX-License-Identifier: AGPL-3.0-or-later
//! Drape spike core: GPU device setup, solver, metrics.

#[cfg(not(target_arch = "wasm32"))]
pub mod attrib;
pub mod bench;
pub mod body;
pub mod constraints;
pub mod dragbench;
pub mod engine;
pub mod gpu;
pub mod gpu_async;
pub mod longrange;
pub mod mesh;
pub mod metrics;
pub mod render;
pub mod scene;
pub mod selfcheck;
pub mod selfcol;
pub mod sim;
pub mod strain;
pub mod timer;
pub mod triangle;
pub mod untangle;
