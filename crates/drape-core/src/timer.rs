//! Opt-in per-pass GPU timing (profiling mode only, see `GpuOptions::gpu_timestamps`).
//!
//! Uses only pass-level `timestamp_writes`, which is all core WebGPU offers, so the same
//! code works natively and in browsers. When the device has no `timestamp-query`, every
//! method is a no-op and `pass_writes` returns `None`, so callers never branch on it.
//! Browsers may quantize timestamps for privacy; check resolution per browser before trusting
//! sub-100 µs numbers (Chrome 150 on M2 gave ~µs-resolution values without any flag).

use crate::gpu_async::map_read;

pub struct GpuTimer {
    inner: Option<Inner>,
    labels: Vec<&'static str>,
}

struct Inner {
    query_set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    capacity: u32,
    period_ns: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PassTime {
    pub label: &'static str,
    pub ms: f64,
}

/// Sum pass times with the same label (e.g. one "stretch" entry per substep), keeping first-seen order.
pub fn sum_by_label(times: &[PassTime]) -> Vec<PassTime> {
    let mut out: Vec<PassTime> = Vec::new();
    for t in times {
        match out.iter_mut().find(|o| o.label == t.label) {
            Some(o) => o.ms += t.ms,
            None => out.push(t.clone()),
        }
    }
    out
}

impl GpuTimer {
    /// `max_passes` = how many passes can be timed per `begin_frame`..`read` cycle.
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, max_passes: u32) -> Self {
        if !device.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
            return Self {
                inner: None,
                labels: Vec::new(),
            };
        }
        let capacity = max_passes * 2;
        let size = capacity as u64 * 8;
        let inner = Inner {
            query_set: device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("gpu-timer"),
                ty: wgpu::QueryType::Timestamp,
                count: capacity,
            }),
            resolve: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("gpu-timer-resolve"),
                size,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            readback: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("gpu-timer-readback"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
            capacity,
            period_ns: queue.get_timestamp_period() as f64,
        };
        Self {
            inner: Some(inner),
            labels: Vec::new(),
        }
    }

    pub fn enabled(&self) -> bool {
        self.inner.is_some()
    }

    pub fn begin_frame(&mut self) {
        self.labels.clear();
    }

    fn next_pair(&mut self, label: &'static str) -> Option<(&wgpu::QuerySet, u32)> {
        let inner = self.inner.as_ref()?;
        let i = self.labels.len() as u32 * 2;
        if i + 2 > inner.capacity {
            log::warn!("GpuTimer full, not timing '{label}'");
            return None;
        }
        self.labels.push(label);
        Some((&inner.query_set, i))
    }

    pub fn render_pass_writes(
        &mut self,
        label: &'static str,
    ) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        self.next_pair(label)
            .map(|(query_set, i)| wgpu::RenderPassTimestampWrites {
                query_set,
                beginning_of_pass_write_index: Some(i),
                end_of_pass_write_index: Some(i + 1),
            })
    }

    pub fn compute_pass_writes(
        &mut self,
        label: &'static str,
    ) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        self.next_pair(label)
            .map(|(query_set, i)| wgpu::ComputePassTimestampWrites {
                query_set,
                beginning_of_pass_write_index: Some(i),
                end_of_pass_write_index: Some(i + 1),
            })
    }

    /// Record the resolve + copy at the end of the frame's last encoder.
    pub fn resolve(&self, encoder: &mut wgpu::CommandEncoder) {
        let Some(inner) = &self.inner else { return };
        let n = self.labels.len() as u32 * 2;
        if n == 0 {
            return;
        }
        encoder.resolve_query_set(&inner.query_set, 0..n, &inner.resolve, 0);
        encoder.copy_buffer_to_buffer(&inner.resolve, 0, &inner.readback, 0, n as u64 * 8);
    }

    /// Read back the timings after the encoder holding `resolve` was submitted.
    /// This is a CPU readback: call it on sampled frames only (hard rule 5).
    pub async fn read(&self, device: &wgpu::Device) -> Vec<PassTime> {
        let Some(inner) = &self.inner else {
            return Vec::new();
        };
        let n = self.labels.len() as u64 * 2;
        if n == 0 {
            return Vec::new();
        }
        let slice = inner.readback.slice(..n * 8);
        map_read(device, &slice)
            .await
            .expect("map gpu-timer readback");
        let ticks: Vec<u64> = {
            let data = slice.get_mapped_range().expect("mapped range");
            bytemuck::cast_slice::<u8, u64>(&data).to_vec()
        };
        inner.readback.unmap();
        self.labels
            .iter()
            .enumerate()
            .map(|(k, &label)| PassTime {
                label,
                ms: ticks[2 * k + 1].wrapping_sub(ticks[2 * k]) as f64 * inner.period_ns / 1e6,
            })
            .collect()
    }
}
