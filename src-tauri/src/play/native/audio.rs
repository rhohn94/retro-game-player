//! The native-play audio chain (W270, polished in W274): core-rate i16
//! batches are resampled (4-point Catmull-Rom interpolation, with dynamic
//! rate control against ring fill) into a lock-free SPSC ring the cpal
//! realtime callback drains — no locks, no allocation, no logging on the
//! realtime path. Replaces W212's `Mutex<VecDeque<i16>>` ring, which ignored
//! the core's reported sample rate entirely (wrong speed/pitch on any
//! core/device rate mismatch) and locked inside the realtime callback. See
//! docs/design/native-emulation-design.md §2.
//!
//! Thread topology: `cpal::Stream` is `!Send`, so the whole device side lives
//! on the audio thread ([`run_audio_thread`]) — it opens the device, sizes
//! the ring from the device rate, keeps the consumer for its callback, and
//! hands the producer back to `NativeRuntime::start` over an mpsc channel.

use crate::error::{AppError, AppResult};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Interleaved-stereo layout: samples per frame. The libretro audio contract
/// is stereo, and the resampler/ring keep that shape end to end.
const STEREO: usize = 2;

/// Ring capacity in milliseconds of device-rate stereo audio. Large enough
/// to absorb core/device cadence jitter, small enough that a stall never
/// turns into a multi-second audio delay once it recovers.
const RING_CAPACITY_MS: u32 = 250;

/// Target ring fill in milliseconds — the level dynamic rate control steers
/// toward, and the pre-fill gate waits for before starting the stream.
/// ~80 ms keeps a comfortable underrun cushion without audible latency.
const TARGET_FILL_MS: u32 = 80;

/// Proportional gain of the dynamic rate control: how strongly a fill error
/// (as a fraction of the target) nudges the resampling ratio. RetroArch's
/// default (`d` in its dynamic-rate-control paper); halved from W270's 0.01
/// in W274 so the worst-case pitch-skew slope while converging stays below
/// audibility on sustained tones.
const DRC_GAIN: f64 = 0.005;

/// Hard cap on the DRC rate skew (±0.5%) — inaudible as a pitch change, but
/// enough to lock the core and device clocks together (the RetroArch model).
const MAX_SKEW: f64 = 0.005;

/// How long the pre-fill gate waits for the ring to reach the target before
/// starting playback anyway — a core that produces little or no audio must
/// not stall the session.
const PREFILL_TIMEOUT: Duration = Duration::from_millis(300);

/// Poll interval while waiting for the pre-fill target.
const PREFILL_POLL: Duration = Duration::from_millis(5);

/// Poll interval for the audio thread's stop flag once the stream is live.
const STOP_POLL: Duration = Duration::from_millis(50);

/// Full-scale i16 magnitude, for i16 ↔ ±1.0 f32 sample conversion.
const I16_FULL_SCALE: f32 = i16::MAX as f32;

/// Equal-weight stereo→mono mixdown factor.
const MONO_MIX: f32 = 0.5;

/// Milliseconds per second, for rate ↔ duration conversions.
const MILLIS_PER_SEC: f64 = 1000.0;

/// Stereo sample count covering `ms` milliseconds at `device_rate`.
fn stereo_samples_for_ms(device_rate: f64, ms: u32) -> usize {
    (device_rate * f64::from(ms) / MILLIS_PER_SEC) as usize * STEREO
}

/// Shared performance counters — written by the core loop (frames) and the
/// audio chain (underruns/overruns), read by the periodic perf log so
/// on-device verification is objective rather than by ear alone.
#[derive(Default)]
pub struct PerfCounters {
    /// Core frames executed (`retro_run` calls that ticked).
    pub frames_run: AtomicU64,
    /// Samples padded with silence because the ring ran dry while the core
    /// was producing (pause-time gaps are deliberately not counted).
    pub underrun_samples: AtomicU64,
    /// Samples dropped because the ring was full when the core pushed.
    pub overrun_samples: AtomicU64,
}

/// The output gain shared between the IPC layer (`set_native_volume` →
/// `NativeRuntime::set_volume`) and the realtime callback, stored as atomic
/// f32 bits so the callback reads it without locking (W235 attract-mode
/// duck / #22 volume control).
pub struct SharedGain {
    bits: AtomicU32,
}

impl SharedGain {
    /// Unit gain (full volume).
    pub fn new() -> Self {
        SharedGain {
            bits: AtomicU32::new(1.0_f32.to_bits()),
        }
    }

    /// Sets the gain, clamped to [0, 1] — never amplifies.
    pub fn set(&self, gain: f32) {
        self.bits
            .store(gain.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    /// The current gain.
    pub fn get(&self) -> f32 {
        f32::from_bits(self.bits.load(Ordering::Relaxed))
    }
}

impl Default for SharedGain {
    fn default() -> Self {
        SharedGain::new()
    }
}

/// The dynamic-rate-control skew for a given ring fill: positive when the
/// ring is below target (produce more samples), negative above it, clamped
/// to ±[`MAX_SKEW`]. Pure so the sign and clamp behavior are unit-testable.
pub fn rate_control_skew(current_fill: usize, target_fill: usize) -> f64 {
    if target_fill == 0 {
        return 0.0;
    }
    let error = (target_fill as f64 - current_fill as f64) / target_fill as f64;
    (DRC_GAIN * error).clamp(-MAX_SKEW, MAX_SKEW)
}

/// True once the output stream should start playing: the ring reached the
/// pre-fill target, or the window timed out (a core producing little or no
/// audio must not stall the session). Pure decision, unit-tested.
pub fn prefill_complete(fill: usize, target_fill: usize, waited: Duration) -> bool {
    fill >= target_fill || waited >= PREFILL_TIMEOUT
}

/// Number of real input frames that must seed the history window before the
/// resampler can interpolate (the segment endpoints `p1`, `p2`; each further
/// input frame is the lookahead `p3`).
const SEED_FRAMES: u8 = 2;

/// 4-point Catmull-Rom (cubic Hermite) interpolation of the segment
/// [`p1`, `p2`] at fractional position `t` ∈ [0, 1), with `p0`/`p3` as the
/// outer control points. Evaluated in Horner form; at `t = 0` this is
/// *exactly* `p1` (`0.5 * (2 * p1)` — both operations exact in binary
/// floating point), which is what keeps identity-ratio passthrough
/// bit-exact. Chosen over W270's linear interpolation because first-order
/// roll-off/aliasing was audible on sustained NES square/triangle tones
/// (W274; docs/design/native-emulation-design.md §2).
fn catmull_rom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let c1 = p2 - p0;
    let c2 = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3;
    let c3 = 3.0 * (p1 - p2) + p3 - p0;
    0.5 * (2.0 * p1 + t * (c1 + t * (c2 + t * c3)))
}

/// Catmull-Rom stereo resampler (W274, upgraded from W270's linear): 4-point
/// cubic interpolation of interleaved i16 core-rate batches into interleaved
/// ±1.0 f32 device-rate samples. Keeps the fractional read position and a
/// three-frame history window across batches, so interpolation is continuous
/// over the whole session (output lags input by two frames — the
/// interpolation history; the spline needs one frame of lookahead past the
/// segment being rendered). Seeding replicates the first input frame into
/// the older history slots so the spline's first segment starts flat instead
/// of swinging through silence. The per-push `skew` is the DRC nudge:
/// `effective_ratio = base_ratio * (1 + skew)`.
pub struct StereoResampler {
    /// Output frames produced per input frame (device rate / core rate).
    base_ratio: f64,
    /// Fractional position within the segment [`history[1]`, `history[2]`],
    /// in [0, 1).
    frac: f64,
    /// Sliding history window `[p0, p1, p2]`; the incoming input frame is the
    /// spline's lookahead point `p3`. Kept across batches for continuity.
    history: [[f32; 2]; 3],
    /// How many real input frames have seeded `history`, saturating at
    /// [`SEED_FRAMES`] (= fully primed).
    seeded: u8,
}

impl StereoResampler {
    /// A resampler converting `core_rate` → `device_rate`. A non-positive
    /// rate on either side (core-controlled input) degrades to pass-through
    /// (ratio 1.0) rather than a division by zero or a wild ratio.
    pub fn new(core_rate: f64, device_rate: f64) -> Self {
        let base_ratio = if core_rate > 0.0 && device_rate > 0.0 {
            device_rate / core_rate
        } else {
            1.0
        };
        StereoResampler {
            base_ratio,
            frac: 0.0,
            history: [[0.0; 2]; 3],
            seeded: 0,
        }
    }

    /// Resamples one interleaved-stereo batch into `out` (cleared first; the
    /// caller reuses the Vec so steady state allocates nothing beyond the
    /// first few calls' capacity growth). Splitting an input across calls
    /// yields exactly the same output as one call — all interpolation state
    /// lives on `self`.
    pub fn resample_into(&mut self, input: &[i16], skew: f64, out: &mut Vec<f32>) {
        out.clear();
        let frames = input.len() / STEREO;
        let ratio = self.base_ratio * (1.0 + skew);
        let step = if ratio > 0.0 { 1.0 / ratio } else { 1.0 };
        for index in 0..frames {
            let cur = Self::frame_at(input, index);
            match self.seeded {
                // Replicate-first-frame seeding: p0 = p1 = first frame, so
                // the first rendered segment starts flat at the first real
                // sample rather than swinging through silence.
                0 => {
                    self.history = [cur, cur, cur];
                    self.seeded = 1;
                    self.frac = 0.0;
                }
                1 => {
                    self.history[2] = cur;
                    self.seeded = SEED_FRAMES;
                }
                _ => {
                    let [p0, p1, p2] = self.history;
                    while self.frac < 1.0 {
                        let t = self.frac as f32;
                        out.push(catmull_rom(p0[0], p1[0], p2[0], cur[0], t));
                        out.push(catmull_rom(p0[1], p1[1], p2[1], cur[1], t));
                        self.frac += step;
                    }
                    self.frac -= 1.0;
                    self.history = [p1, p2, cur];
                }
            }
        }
    }

    /// The `frame`-th stereo pair of `input`, normalized to ±1.0.
    fn frame_at(input: &[i16], frame: usize) -> [f32; 2] {
        [
            f32::from(input[frame * STEREO]) / I16_FULL_SCALE,
            f32::from(input[frame * STEREO + 1]) / I16_FULL_SCALE,
        ]
    }
}

/// The core thread's handle on the ring: pushes resampled samples, reports
/// fill for DRC and the perf log. Whole stereo frames only — a partial
/// frame is never made visible to the consumer.
pub struct AudioProducer {
    producer: rtrb::Producer<f32>,
    target_fill: usize,
    counters: Arc<PerfCounters>,
}

impl AudioProducer {
    fn new(producer: rtrb::Producer<f32>, target_fill: usize, counters: Arc<PerfCounters>) -> Self {
        AudioProducer {
            producer,
            target_fill,
            counters,
        }
    }

    /// Committed samples currently readable in the ring.
    pub fn fill(&self) -> usize {
        self.producer.buffer().capacity() - self.producer.slots()
    }

    /// Ring fill expressed as milliseconds of audio at `device_rate`.
    pub fn fill_ms(&self, device_rate: f64) -> f64 {
        if device_rate <= 0.0 {
            return 0.0;
        }
        (self.fill() / STEREO) as f64 * MILLIS_PER_SEC / device_rate
    }

    /// The DRC skew for the current fill level (see [`rate_control_skew`]).
    pub fn skew(&self) -> f64 {
        rate_control_skew(self.fill(), self.target_fill)
    }

    /// Pushes interleaved-stereo samples, whole frames only; whatever doesn't
    /// fit is dropped (newest-loses) and counted as overrun. In steady state
    /// DRC keeps the fill near target, so drops indicate a real stall.
    pub fn push(&mut self, samples: &[f32]) {
        if self.producer.is_abandoned() {
            return; // stream bring-up failed after handoff — video-only session
        }
        let writable = self.producer.slots().min(samples.len()) & !1;
        if writable > 0 {
            if let Ok(chunk) = self.producer.write_chunk_uninit(writable) {
                let _ = chunk.fill_from_iter(samples[..writable].iter().copied());
            }
        }
        let dropped = samples.len() - writable;
        if dropped > 0 {
            self.counters
                .overrun_samples
                .fetch_add(dropped as u64, Ordering::Relaxed);
        }
    }
}

/// What the audio thread hands back to `NativeRuntime::start` once the
/// device is open and the ring exists: the device's actual rate (for the
/// resampler) and the producer end of the ring (for the core thread).
pub struct AudioBringUp {
    pub device_rate: f64,
    pub producer: AudioProducer,
}

/// The consumer side living inside the realtime callback. `fill_*` pop whole
/// stereo frames straight into the output buffer with gain applied inline —
/// no locks, no allocation, no logging (realtime-safety contract).
struct StreamFeeder {
    consumer: rtrb::Consumer<f32>,
    /// The device's actual channel count (stereo frames are mapped onto it).
    channels: usize,
    gain: Arc<SharedGain>,
    /// While the core is paused the ring legitimately runs dry — those gaps
    /// are not counted as underruns, keeping the perf log honest.
    paused: Arc<AtomicBool>,
    counters: Arc<PerfCounters>,
}

impl StreamFeeder {
    fn fill_f32(&mut self, out: &mut [f32]) {
        self.fill_frames(out, |sample| sample);
    }

    fn fill_i16(&mut self, out: &mut [i16]) {
        self.fill_frames(out, f32_to_i16);
    }

    /// Fills `out` (interleaved, `self.channels` samples per device frame)
    /// from the ring: 1 output channel gets an L+R mixdown, ≥2 get L,R in
    /// the first two with the rest silent. A dry ring pads silence and
    /// counts underrun samples (unless paused). Consumes whole stereo
    /// frames only.
    fn fill_frames<T: Copy>(&mut self, out: &mut [T], convert: impl Fn(f32) -> T) {
        let gain = self.gain.get();
        let producing = !self.paused.load(Ordering::Relaxed);
        let channels = self.channels.max(1);
        let mut missing: u64 = 0;
        for frame in out.chunks_mut(channels) {
            // SPSC: only this callback pops, so an observed >= STEREO can
            // only grow — the two pops below cannot fail.
            let (l, r) = if self.consumer.slots() >= STEREO {
                (
                    self.consumer.pop().unwrap_or(0.0) * gain,
                    self.consumer.pop().unwrap_or(0.0) * gain,
                )
            } else {
                missing += STEREO as u64;
                (0.0, 0.0)
            };
            write_device_frame(frame, l, r, &convert);
        }
        if producing && missing > 0 {
            self.counters
                .underrun_samples
                .fetch_add(missing, Ordering::Relaxed);
        }
    }
}

/// Maps one stereo frame onto a device frame of arbitrary channel count:
/// mono mixes L+R, multichannel puts L,R in the first two and silences the
/// rest.
fn write_device_frame<T: Copy>(frame: &mut [T], l: f32, r: f32, convert: &impl Fn(f32) -> T) {
    match frame.len() {
        0 => {}
        1 => frame[0] = convert((l + r) * MONO_MIX),
        _ => {
            frame[0] = convert(l);
            frame[1] = convert(r);
            for extra in &mut frame[2..] {
                *extra = convert(0.0);
            }
        }
    }
}

/// ±1.0 f32 → full-scale i16, saturating at the rails.
fn f32_to_i16(sample: f32) -> i16 {
    (sample * I16_FULL_SCALE).clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16
}

/// The audio thread's entry point: opens the default output device, sizes
/// the ring from the device rate, sends the producer back through `ready`,
/// pre-fills, then owns the `cpal::Stream` (which is `!Send`) until `stop`.
/// Any failure is reported through `ready` (before handoff) or logged
/// (after) — the session then runs video-only, matching W212's degraded
/// behavior.
pub fn run_audio_thread(
    ready: &Sender<AppResult<AudioBringUp>>,
    stop: &Arc<AtomicBool>,
    paused: &Arc<AtomicBool>,
    gain: &Arc<SharedGain>,
    counters: &Arc<PerfCounters>,
) {
    let (device, config) = match open_default_output() {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let device_rate = f64::from(config.sample_rate().0);
    if device_rate <= 0.0 {
        let _ = ready.send(Err(AppError::Dependency(
            "audio device reported a non-positive sample rate".into(),
        )));
        return;
    }
    let channels = usize::from(config.channels());
    let target_fill = stereo_samples_for_ms(device_rate, TARGET_FILL_MS);
    let (producer, consumer) =
        rtrb::RingBuffer::new(stereo_samples_for_ms(device_rate, RING_CAPACITY_MS));
    let _ = ready.send(Ok(AudioBringUp {
        device_rate,
        producer: AudioProducer::new(producer, target_fill, Arc::clone(counters)),
    }));

    // Pre-fill: hold the consumer (stream not built yet, so no callbacks
    // fire) until the core thread has filled the ring to target — the first
    // real callback then has a full cushion instead of cold-start garble.
    let wait_start = Instant::now();
    while !stop.load(Ordering::Relaxed)
        && !prefill_complete(consumer.slots(), target_fill, wait_start.elapsed())
    {
        std::thread::sleep(PREFILL_POLL);
    }

    let feeder = StreamFeeder {
        consumer,
        channels,
        gain: Arc::clone(gain),
        paused: Arc::clone(paused),
        counters: Arc::clone(counters),
    };
    let stream = match build_stream(&device, &config, feeder) {
        Ok(stream) => stream,
        Err(e) => {
            eprintln!("[rgp-native] audio unavailable, continuing video-only: {e}");
            return;
        }
    };
    if let Err(e) = stream.play() {
        eprintln!("[rgp-native] audio stream failed to start, continuing video-only: {e}");
        return;
    }
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(STOP_POLL);
    }
    // `stream` drops here, stopping playback before the thread exits.
}

/// The default output device and its default (native) stream config — the
/// rates/format the rest of the chain adapts to.
fn open_default_output() -> AppResult<(cpal::Device, cpal::SupportedStreamConfig)> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| AppError::Dependency("no default audio output device".into()))?;
    let config = device
        .default_output_config()
        .map_err(|e| AppError::Dependency(format!("no usable output config: {e}")))?;
    Ok((device, config))
}

/// Builds (but does not start) the output stream around `feeder`, matching
/// the device's sample format. Only I16 and F32 devices are supported —
/// macOS CoreAudio reports F32 in practice.
fn build_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    mut feeder: StreamFeeder,
) -> AppResult<cpal::Stream> {
    let err_fn = |e| eprintln!("[rgp-native] audio output stream error: {e}");
    let stream_config = config.config();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| feeder.fill_f32(data),
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_output_stream(
            &stream_config,
            move |data: &mut [i16], _| feeder.fill_i16(data),
            err_fn,
            None,
        ),
        other => {
            return Err(AppError::Unsupported(format!(
                "unsupported audio output sample format: {other:?}"
            )))
        }
    };
    stream.map_err(|e| AppError::Dependency(format!("failed to build audio stream: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ±1.0 f32 for an i16 sample — mirrors the resampler's normalization.
    fn norm(sample: i16) -> f32 {
        f32::from(sample) / I16_FULL_SCALE
    }

    fn producer_with_capacity(capacity: usize) -> (AudioProducer, rtrb::Consumer<f32>) {
        let (producer, consumer) = rtrb::RingBuffer::new(capacity);
        (
            AudioProducer::new(producer, capacity / 2, Arc::new(PerfCounters::default())),
            consumer,
        )
    }

    struct FeederFixture {
        feeder: StreamFeeder,
        producer: rtrb::Producer<f32>,
        gain: Arc<SharedGain>,
        paused: Arc<AtomicBool>,
        counters: Arc<PerfCounters>,
    }

    fn feeder_with(ring_samples: &[f32], channels: usize) -> FeederFixture {
        let (mut producer, consumer) = rtrb::RingBuffer::new(64);
        for &s in ring_samples {
            producer.push(s).expect("test ring big enough");
        }
        let gain = Arc::new(SharedGain::new());
        let paused = Arc::new(AtomicBool::new(false));
        let counters = Arc::new(PerfCounters::default());
        FeederFixture {
            feeder: StreamFeeder {
                consumer,
                channels,
                gain: Arc::clone(&gain),
                paused: Arc::clone(&paused),
                counters: Arc::clone(&counters),
            },
            producer,
            gain,
            paused,
            counters,
        }
    }

    // --- resampler ---

    #[test]
    fn identity_ratio_passes_samples_through_across_batches() {
        let mut rs = StereoResampler::new(48_000.0, 48_000.0);
        let mut out = Vec::new();
        // Frames f0..f3.
        rs.resample_into(&[10, -10, 20, -20, 30, -30, 40, -40], 0.0, &mut out);
        // Two-frame interpolation latency (segment endpoints + spline
        // lookahead): f0..f1 come out of the first batch, bit-exact — the
        // Catmull-Rom spline interpolates *through* its control points.
        assert_eq!(
            out,
            vec![norm(10), norm(-10), norm(20), norm(-20)]
        );
        // Frames f4..f5 — f2 and f3 (held as history) emerge.
        rs.resample_into(&[50, -50, 60, -60], 0.0, &mut out);
        assert_eq!(out, vec![norm(30), norm(-30), norm(40), norm(-40)]);
    }

    #[test]
    fn two_to_one_ratio_halves_the_output_keeping_every_other_frame() {
        let mut rs = StereoResampler::new(96_000.0, 48_000.0);
        let mut out = Vec::new();
        // Frames f0..f7, mono-ish values on both channels for readability.
        let input: Vec<i16> = (0..8).flat_map(|f| [f * 100, f * 100]).collect();
        rs.resample_into(&input, 0.0, &mut out);
        // Two seed frames, then every other segment start: f0, f2, f4 (f6 is
        // still held as interpolation history).
        let expected: Vec<f32> = [0, 2, 4]
            .iter()
            .flat_map(|&f| [norm(f * 100), norm(f * 100)])
            .collect();
        assert_eq!(out, expected);
    }

    #[test]
    fn positive_skew_produces_more_output_frames() {
        let mut rs = StereoResampler::new(48_000.0, 48_000.0);
        let mut out = Vec::new();
        let input = vec![0i16; 1002 * STEREO]; // 1000 segments after seeding
        rs.resample_into(&input, MAX_SKEW, &mut out);
        let out_frames = out.len() / STEREO;
        // ~1000 * 1.005 = ~1005 output frames.
        assert!(
            (1003..=1007).contains(&out_frames),
            "expected ~1005 frames, got {out_frames}"
        );
    }

    #[test]
    fn negative_skew_produces_fewer_output_frames() {
        let mut rs = StereoResampler::new(48_000.0, 48_000.0);
        let mut out = Vec::new();
        let input = vec![0i16; 1002 * STEREO]; // 1000 segments after seeding
        rs.resample_into(&input, -MAX_SKEW, &mut out);
        let out_frames = out.len() / STEREO;
        assert!(
            (993..=997).contains(&out_frames),
            "expected ~995 frames, got {out_frames}"
        );
    }

    /// Catmull-Rom reproduces any locally-linear signal exactly (a cubic
    /// through collinear control points is the line itself), so a 1:2
    /// upsample of a ramp must yield the ramp's exact integer points and
    /// exact midpoints wherever all four control points sit on the ramp.
    #[test]
    fn upsampling_a_linear_ramp_yields_exact_midpoints() {
        let mut rs = StereoResampler::new(24_000.0, 48_000.0); // 1:2
        let mut out = Vec::new();
        // Ramp frames f0..f6: L = i*100, R = -i*100.
        let input: Vec<i16> = (0..7).flat_map(|i| [i * 100, -i * 100]).collect();
        rs.resample_into(&input, 0.0, &mut out);
        // Five segments render (two seed frames), two outputs each (t = 0,
        // t = 0.5). Segment 0's p0 is the replicated seed frame (off-ramp),
        // so its midpoint is excluded from the exactness property; its t = 0
        // output is still exactly f0.
        assert_eq!(out.len(), 5 * 2 * STEREO);
        assert_eq!(out[0], norm(0));
        assert_eq!(out[1], norm(0));
        // Segments 1..4 have all four control points on the ramp: outputs
        // are the exact ramp values 100, 150, 200, 250, ... (approximate
        // comparison only for float-rounding in the last ulp).
        let expected: Vec<f32> = (0..8)
            .flat_map(|k| {
                let v = 100.0 + 50.0 * k as f32;
                [v / I16_FULL_SCALE, -v / I16_FULL_SCALE]
            })
            .collect();
        for (got, want) in out[2 * STEREO..].iter().zip(expected) {
            assert!((got - want).abs() < 1e-6, "got {got}, want {want}");
        }
    }

    /// All interpolation state (history window + fractional position) lives
    /// on the resampler, so splitting one input into two pushes must yield
    /// exactly the same output as pushing it whole (cross-batch continuity).
    #[test]
    fn splitting_a_batch_across_pushes_yields_identical_output() {
        let input: Vec<i16> = (0..64i16)
            .flat_map(|i| [i.wrapping_mul(517) % 1000, i.wrapping_mul(311) % 1000])
            .collect();
        let mut whole = Vec::new();
        StereoResampler::new(44_100.0, 48_000.0).resample_into(&input, 0.0, &mut whole);

        let mut rs = StereoResampler::new(44_100.0, 48_000.0);
        let mut split = Vec::new();
        let mut tail = Vec::new();
        rs.resample_into(&input[..10 * STEREO], 0.0, &mut split);
        rs.resample_into(&input[10 * STEREO..], 0.0, &mut tail);
        split.extend_from_slice(&tail);
        assert_eq!(split, whole);
    }

    #[test]
    fn non_positive_rates_degrade_to_pass_through() {
        for (core, device) in [(0.0, 48_000.0), (-1.0, 48_000.0), (44_100.0, 0.0)] {
            let mut rs = StereoResampler::new(core, device);
            let mut out = Vec::new();
            rs.resample_into(&[10, -10, 20, -20, 30, -30], 0.0, &mut out);
            assert_eq!(out, vec![norm(10), norm(-10)], "rates {core}/{device}");
        }
    }

    #[test]
    fn empty_batch_produces_no_output() {
        let mut rs = StereoResampler::new(44_100.0, 48_000.0);
        let mut out = vec![1.0f32]; // stale content must be cleared
        rs.resample_into(&[], 0.0, &mut out);
        assert!(out.is_empty());
    }

    // --- dynamic rate control ---

    #[test]
    fn drc_skew_is_positive_when_the_ring_is_below_target() {
        let skew = rate_control_skew(500, 1000);
        assert!(skew > 0.0);
        assert_eq!(skew, DRC_GAIN * 0.5);
    }

    #[test]
    fn drc_skew_is_negative_when_the_ring_is_above_target() {
        let skew = rate_control_skew(1500, 1000);
        assert!(skew < 0.0);
        assert_eq!(skew, DRC_GAIN * -0.5);
    }

    #[test]
    fn drc_skew_is_zero_at_target_fill() {
        assert_eq!(rate_control_skew(1000, 1000), 0.0);
    }

    #[test]
    fn drc_skew_clamps_at_the_maximum_in_both_directions() {
        // At the RetroArch-default gain (0.005 = MAX_SKEW) a fully-empty
        // ring lands exactly on the positive clamp; a huge overfill error
        // still clamps at the negative rail.
        assert_eq!(rate_control_skew(0, 1000), MAX_SKEW);
        assert_eq!(rate_control_skew(1_000_000, 1000), -MAX_SKEW);
    }

    #[test]
    fn drc_skew_with_zero_target_is_zero() {
        assert_eq!(rate_control_skew(500, 0), 0.0);
    }

    // --- producer ---

    #[test]
    fn producer_push_and_fill_round_trip() {
        let (mut producer, _consumer) = producer_with_capacity(16);
        assert_eq!(producer.fill(), 0);
        producer.push(&[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(producer.fill(), 4);
        assert_eq!(producer.counters.overrun_samples.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn producer_overflow_drops_the_remainder_and_counts_overrun() {
        let (mut producer, _consumer) = producer_with_capacity(4);
        producer.push(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        assert_eq!(producer.fill(), 4);
        assert_eq!(producer.counters.overrun_samples.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn producer_never_commits_a_partial_stereo_frame() {
        let (mut producer, _consumer) = producer_with_capacity(5);
        producer.push(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        // 5 free slots → only 4 (two whole frames) written, 2 dropped.
        assert_eq!(producer.fill(), 4);
        assert_eq!(producer.counters.overrun_samples.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn producer_push_after_the_consumer_is_gone_is_a_silent_no_op() {
        let (mut producer, consumer) = producer_with_capacity(4);
        drop(consumer);
        producer.push(&[0.1, 0.2]);
        assert_eq!(producer.counters.overrun_samples.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn producer_skew_tracks_fill_against_target() {
        // Capacity 16 → target 8 (fixture convention).
        let (mut producer, _consumer) = producer_with_capacity(16);
        assert_eq!(producer.skew(), MAX_SKEW); // empty ring, far below target
        producer.push(&[0.0; 8]);
        assert_eq!(producer.skew(), 0.0); // exactly at target
    }

    #[test]
    fn fill_ms_converts_stereo_samples_to_milliseconds() {
        let (mut producer, _consumer) = producer_with_capacity(96);
        producer.push(&[0.0; 96]); // 48 stereo frames
        assert_eq!(producer.fill_ms(48_000.0), 1.0);
        assert_eq!(producer.fill_ms(0.0), 0.0);
    }

    // --- pre-fill gate ---

    #[test]
    fn prefill_waits_while_below_target_and_within_the_window() {
        assert!(!prefill_complete(0, 100, Duration::ZERO));
        assert!(!prefill_complete(
            99,
            100,
            PREFILL_TIMEOUT - Duration::from_millis(1)
        ));
    }

    #[test]
    fn prefill_completes_at_target_fill() {
        assert!(prefill_complete(100, 100, Duration::ZERO));
    }

    #[test]
    fn prefill_completes_on_timeout_even_when_underfilled() {
        assert!(prefill_complete(0, 100, PREFILL_TIMEOUT));
    }

    // --- gain ---

    #[test]
    fn gain_clamps_to_the_unit_range() {
        let gain = SharedGain::new();
        assert_eq!(gain.get(), 1.0);
        gain.set(7.5); // never amplifies
        assert_eq!(gain.get(), 1.0);
        gain.set(-3.0); // full mute floor
        assert_eq!(gain.get(), 0.0);
        gain.set(0.5);
        assert_eq!(gain.get(), 0.5);
    }

    // --- realtime feeder ---

    #[test]
    fn feeder_pops_stereo_frames_in_fifo_order() {
        let mut fx = feeder_with(&[0.1, 0.2, 0.3, 0.4], 2);
        let mut out = [0.0f32; 4];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(fx.counters.underrun_samples.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn feeder_applies_gain_inline() {
        let mut fx = feeder_with(&[0.5, -0.5], 2);
        fx.gain.set(0.5);
        let mut out = [0.0f32; 2];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.25, -0.25]);
    }

    #[test]
    fn feeder_pads_silence_and_counts_underrun_when_the_ring_runs_dry() {
        let mut fx = feeder_with(&[0.1, 0.2], 2);
        let mut out = [9.0f32; 6];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.1, 0.2, 0.0, 0.0, 0.0, 0.0]);
        assert_eq!(fx.counters.underrun_samples.load(Ordering::Relaxed), 4);
    }

    #[test]
    fn feeder_does_not_count_underruns_while_paused() {
        let mut fx = feeder_with(&[], 2);
        fx.paused.store(true, Ordering::Relaxed);
        let mut out = [9.0f32; 4];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.0; 4]); // still silence-padded
        assert_eq!(fx.counters.underrun_samples.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn feeder_never_splits_a_stereo_frame_on_a_half_filled_ring() {
        // One and a half frames in the ring: the half frame must stay queued
        // (whole-frame consumption), not be paired with silence.
        let mut fx = feeder_with(&[0.1, 0.2, 0.3], 2);
        let mut out = [9.0f32; 4];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.1, 0.2, 0.0, 0.0]);
        // The orphaned 0.3 is completed by a later push and consumed then.
        fx.producer.push(0.4).expect("space available");
        let mut out = [9.0f32; 2];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.3, 0.4]);
    }

    #[test]
    fn feeder_mixes_down_to_mono_devices() {
        let mut fx = feeder_with(&[0.5, 0.25], 1);
        let mut out = [9.0f32; 1];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.375]);
    }

    #[test]
    fn feeder_zeroes_channels_beyond_stereo() {
        let mut fx = feeder_with(&[0.5, -0.5], 4);
        let mut out = [9.0f32; 4];
        fx.feeder.fill_f32(&mut out);
        assert_eq!(out, [0.5, -0.5, 0.0, 0.0]);
    }

    #[test]
    fn feeder_converts_to_i16_devices_per_sample() {
        let mut fx = feeder_with(&[1.0, -1.0, 0.5, 0.0], 2);
        let mut out = [0i16; 4];
        fx.feeder.fill_i16(&mut out);
        assert_eq!(out[0], i16::MAX);
        assert_eq!(out[1], -i16::MAX);
        assert_eq!(out[2], i16::MAX / 2); // 0.5 * 32767 = 16383.5, truncated
        assert_eq!(out[3], 0);
    }

    #[test]
    fn f32_to_i16_saturates_at_the_rails() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), i16::MIN);
        assert_eq!(f32_to_i16(0.0), 0);
    }

    #[test]
    fn stereo_samples_for_ms_scales_with_rate_and_window() {
        assert_eq!(stereo_samples_for_ms(48_000.0, 80), 7_680);
        assert_eq!(stereo_samples_for_ms(48_000.0, 250), 24_000);
        assert_eq!(stereo_samples_for_ms(0.0, 80), 0);
    }
}
