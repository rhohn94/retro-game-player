//! Draining queued core audio batches through the resampler into the
//! realtime ring. W270 — see docs/design/native-emulation-design.md §2.

use super::session::CoreAudio;
use crate::play::native::callbacks::{self, AudioBatch};

/// Resamples each queued core batch to the device rate — with the DRC skew
/// for the ring's current fill — and pushes it into the ring. Without an
/// audio output, batches are drained and discarded (video-only session).
pub(super) fn drain_audio(
    channels: &callbacks::CallbackChannels,
    audio: &mut Option<CoreAudio>,
    scratch: &mut Vec<f32>,
) {
    while let Ok(AudioBatch { samples }) = channels.audio.try_recv() {
        let Some(audio) = audio.as_mut() else {
            continue;
        };
        let skew = audio.producer.skew();
        audio.resampler.resample_into(&samples, skew, scratch);
        audio.producer.push(scratch);
    }
}
