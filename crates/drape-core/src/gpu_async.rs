//! Waiting on the GPU from code that runs on both targets.
//! Native: `device.poll` blocks until done. Web: the browser resolves the callback and
//! the future wakes up; `device.poll` is a no-op there.

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
};

struct Shared<T> {
    value: Option<T>,
    waker: Option<Waker>,
}

/// Minimal one-shot channel: the sender is a `FnOnce(T)` suitable for wgpu callbacks.
fn oneshot<T: Send + 'static>() -> (impl FnOnce(T) + Send + 'static, Receiver<T>) {
    let shared = Arc::new(Mutex::new(Shared {
        value: None,
        waker: None,
    }));
    let s = shared.clone();
    let send = move |v: T| {
        let mut g = s.lock().unwrap();
        g.value = Some(v);
        if let Some(w) = g.waker.take() {
            w.wake();
        }
    };
    (send, Receiver(shared))
}

struct Receiver<T>(Arc<Mutex<Shared<T>>>);

impl<T> Future for Receiver<T> {
    type Output = T;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut g = self.0.lock().unwrap();
        match g.value.take() {
            Some(v) => Poll::Ready(v),
            None => {
                g.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

fn block_native(device: &wgpu::Device) {
    #[cfg(not(target_arch = "wasm32"))]
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .expect("device poll");
    #[cfg(target_arch = "wasm32")]
    let _ = device;
}

/// Map a buffer slice for reading.
pub async fn map_read(
    device: &wgpu::Device,
    slice: &wgpu::BufferSlice<'_>,
) -> Result<(), wgpu::BufferAsyncError> {
    let (send, recv) = oneshot();
    slice.map_async(wgpu::MapMode::Read, send);
    block_native(device);
    recv.await
}

/// Resolves when everything submitted so far has finished on the GPU.
pub async fn work_done(device: &wgpu::Device, queue: &wgpu::Queue) {
    let (send, recv) = oneshot::<()>();
    queue.on_submitted_work_done(move || send(()));
    block_native(device);
    recv.await
}

/// Read a whole small buffer (must have MAP_READ) into a Vec of `T`.
pub async fn read_buffer<T: bytemuck::Pod>(device: &wgpu::Device, buffer: &wgpu::Buffer) -> Vec<T> {
    let slice = buffer.slice(..);
    map_read(device, &slice).await.expect("map_read");
    let out = {
        let data = slice.get_mapped_range().expect("mapped range");
        bytemuck::cast_slice::<u8, T>(&data).to_vec()
    };
    buffer.unmap();
    out
}
