// SPDX-License-Identifier: AGPL-3.0-or-later
//! Vitryne solver: GPU device setup, solver, metrics. Rendering lives in vitryne-render.

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
pub mod regress;
pub mod scene;
pub mod selfcheck;
pub mod selfcol;
pub mod sim;
pub mod strain;
pub mod timer;
pub mod untangle;
