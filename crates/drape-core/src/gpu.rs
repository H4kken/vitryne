//! Device init. Hard rule 1: WebGPU core only, on every target.

use serde::Serialize;

/// Backends we allow. Web: WebGPU only (never WebGL). Native: the WebGPU-class APIs.
pub fn allowed_backends() -> wgpu::Backends {
    if cfg!(target_arch = "wasm32") {
        wgpu::Backends::BROWSER_WEBGPU
    } else {
        wgpu::Backends::METAL | wgpu::Backends::VULKAN | wgpu::Backends::DX12
    }
}

pub fn create_instance() -> wgpu::Instance {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = allowed_backends();
    wgpu::Instance::new(desc)
}

/// How the device is created. `Default` is the canonical mode used for every pass/fail number.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct GpuOptions {
    /// Opt-in profiling mode: additionally request WebGPU's `timestamp-query`
    /// (pass-level `timestampWrites` only, which is all core WebGPU has).
    /// Never used for pass/fail numbers; every report says whether it was on.
    pub gpu_timestamps: bool,
}

/// Features we request. Canonical mode: none (hard rule 1).
/// Profiling mode: `TIMESTAMP_QUERY` and nothing else, if the adapter has it.
pub fn required_features(opts: GpuOptions, adapter: &wgpu::Adapter) -> wgpu::Features {
    if opts.gpu_timestamps {
        if adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
            return wgpu::Features::TIMESTAMP_QUERY;
        }
        log::warn!(
            "gpu_timestamps requested but adapter lacks timestamp-query; continuing without"
        );
    }
    wgpu::Features::empty()
}

pub fn required_limits() -> wgpu::Limits {
    wgpu::Limits::default()
}

pub struct Gpu {
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub report: AdapterReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterReport {
    pub name: String,
    pub vendor: u32,
    pub device: u32,
    pub device_type: String,
    pub driver: String,
    pub driver_info: String,
    pub backend: String,
    /// Features the adapter could give us (we request none of them).
    pub adapter_features: String,
    /// What the adapter supports (we don't request it).
    pub adapter_limits: LimitsSummary,
    /// What the device was created with: must equal the WebGPU defaults.
    pub device_limits: LimitsSummary,
    pub device_features: String,
    /// True only in the opt-in profiling mode (device has `timestamp-query`).
    pub gpu_timestamps: bool,
}

/// The limits that matter for this spike, kept short enough to read in a log.
#[derive(Debug, Clone, Serialize)]
pub struct LimitsSummary {
    pub max_storage_buffer_binding_size: u64,
    pub max_buffer_size: u64,
    pub max_storage_buffers_per_shader_stage: u32,
    pub max_uniform_buffer_binding_size: u64,
    pub max_bind_groups: u32,
    pub max_compute_workgroup_size_x: u32,
    pub max_compute_invocations_per_workgroup: u32,
    pub max_compute_workgroup_storage_size: u32,
    pub max_compute_workgroups_per_dimension: u32,
    pub max_texture_dimension_3d: u32,
    pub max_immediate_size: u32,
}

impl From<&wgpu::Limits> for LimitsSummary {
    fn from(l: &wgpu::Limits) -> Self {
        Self {
            max_storage_buffer_binding_size: l.max_storage_buffer_binding_size,
            max_buffer_size: l.max_buffer_size,
            max_storage_buffers_per_shader_stage: l.max_storage_buffers_per_shader_stage,
            max_uniform_buffer_binding_size: l.max_uniform_buffer_binding_size,
            max_bind_groups: l.max_bind_groups,
            max_compute_workgroup_size_x: l.max_compute_workgroup_size_x,
            max_compute_invocations_per_workgroup: l.max_compute_invocations_per_workgroup,
            max_compute_workgroup_storage_size: l.max_compute_workgroup_storage_size,
            max_compute_workgroups_per_dimension: l.max_compute_workgroups_per_dimension,
            max_texture_dimension_3d: l.max_texture_dimension_3d,
            max_immediate_size: l.max_immediate_size,
        }
    }
}

impl Gpu {
    /// `surface` is optional so the headless bench can share this path.
    pub async fn new(
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
        opts: GpuOptions,
    ) -> Result<Self, String> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: surface,
                // Report the real adapter limits; the device is pinned to defaults anyway.
                apply_limit_buckets: false,
            })
            .await
            .map_err(|e| format!("no WebGPU adapter: {e}"))?;

        let features = required_features(opts, &adapter);
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("drape-device"),
                required_features: features,
                required_limits: required_limits(),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("request_device failed: {e}"))?;

        // Belt and braces: fail loudly if the device ever drifts from WebGPU defaults.
        assert_eq!(
            device.features(),
            features,
            "device features differ from what we requested"
        );
        assert!(
            (features - wgpu::Features::TIMESTAMP_QUERY).is_empty(),
            "only timestamp-query may ever be requested, and only in profiling mode"
        );
        assert_eq!(
            device.limits(),
            wgpu::Limits::default(),
            "device limits != WebGPU defaults"
        );

        let info = adapter.get_info();
        let report = AdapterReport {
            name: info.name.clone(),
            vendor: info.vendor,
            device: info.device,
            device_type: format!("{:?}", info.device_type),
            driver: info.driver.clone(),
            driver_info: info.driver_info.clone(),
            backend: format!("{:?}", info.backend),
            adapter_features: format!("{:?}", adapter.features()),
            adapter_limits: (&adapter.limits()).into(),
            device_limits: (&device.limits()).into(),
            device_features: format!("{:?}", device.features()),
            gpu_timestamps: features.contains(wgpu::Features::TIMESTAMP_QUERY),
        };
        log::info!(
            "adapter: {}",
            serde_json::to_string_pretty(&report).unwrap_or_default()
        );

        Ok(Self {
            adapter,
            device,
            queue,
            report,
        })
    }
}
