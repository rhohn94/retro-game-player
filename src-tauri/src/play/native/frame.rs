//! Pixel-format conversion: a core's raw video buffer (whichever of the three
//! libretro pixel formats it negotiated) to tightly-packed RGBA8888 bytes —
//! the format the frontend's `putImageData` expects. W214 — see
//! docs/design/native-emulation-design.md §3.

use super::callbacks::{PixelFormat, VideoFrame};

/// A decoded frame ready for `ImageData`/`putImageData` — tightly packed (no
/// pitch padding), 4 bytes per pixel, row-major, `width * height * 4` bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Rgba8Frame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Converts `frame`'s raw bytes (in `format`) to RGBA8888, stripping any
/// pitch padding along the way (a core's row stride may exceed
/// `width * bytes_per_pixel` for alignment).
pub fn to_rgba8(frame: &VideoFrame, format: PixelFormat) -> Rgba8Frame {
    let (width, height, pitch) = (frame.width as usize, frame.height as usize, frame.pitch);
    let bytes_per_pixel = match format {
        PixelFormat::Xrgb8888 => 4,
        PixelFormat::Rgb1555 | PixelFormat::Rgb565 => 2,
    };
    let mut out = vec![0u8; width * height * 4];
    for row in 0..height {
        let row_start = row * pitch;
        for col in 0..width {
            let px_start = row_start + col * bytes_per_pixel;
            if px_start + bytes_per_pixel > frame.data.len() {
                continue; // a short/corrupt frame — leave this pixel transparent black
            }
            let out_start = (row * width + col) * 4;
            let rgba = pixel_to_rgba(&frame.data[px_start..px_start + bytes_per_pixel], format);
            out[out_start..out_start + 4].copy_from_slice(&rgba);
        }
    }
    Rgba8Frame {
        data: out,
        width: frame.width,
        height: frame.height,
    }
}

fn pixel_to_rgba(px: &[u8], format: PixelFormat) -> [u8; 4] {
    match format {
        // libretro's XRGB8888 is a native-endian (little-endian on Apple
        // Silicon) 32-bit 0xXXRRGGBB value, so byte order in memory is
        // [B, G, R, X].
        PixelFormat::Xrgb8888 => [px[2], px[1], px[0], 255],
        // RGB565: native-endian u16, bits R(5) G(6) B(5) from MSB to LSB.
        PixelFormat::Rgb565 => {
            let v = u16::from_le_bytes([px[0], px[1]]);
            let r5 = ((v >> 11) & 0x1F) as u8;
            let g6 = ((v >> 5) & 0x3F) as u8;
            let b5 = (v & 0x1F) as u8;
            [expand5(r5), expand6(g6), expand5(b5), 255]
        }
        // 0RGB1555: native-endian u16, top bit unused, then R(5) G(5) B(5).
        PixelFormat::Rgb1555 => {
            let v = u16::from_le_bytes([px[0], px[1]]);
            let r5 = ((v >> 10) & 0x1F) as u8;
            let g5 = ((v >> 5) & 0x1F) as u8;
            let b5 = (v & 0x1F) as u8;
            [expand5(r5), expand5(g5), expand5(b5), 255]
        }
    }
}

/// Bit-replication 5-to-8-bit channel expansion (e.g. `0b11111 ->
/// 0b11111111`) — the standard exact upscale, unlike a naive `* 255 / 31`
/// which rounds unevenly at the extremes.
fn expand5(v: u8) -> u8 {
    (v << 3) | (v >> 2)
}

/// Bit-replication 6-to-8-bit channel expansion.
fn expand6(v: u8) -> u8 {
    (v << 2) | (v >> 4)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(data: Vec<u8>, width: u32, height: u32, pitch: usize) -> VideoFrame {
        VideoFrame {
            data,
            width,
            height,
            pitch,
        }
    }

    #[test]
    fn xrgb8888_pure_red_converts_correctly() {
        // One pixel: B=0x00, G=0x00, R=0xFF, X=0x00 (little-endian 0x00FF0000).
        let f = frame(vec![0x00, 0x00, 0xFF, 0x00], 1, 1, 4);
        let out = to_rgba8(&f, PixelFormat::Xrgb8888);
        assert_eq!(out.data, vec![0xFF, 0x00, 0x00, 255]);
        assert_eq!((out.width, out.height), (1, 1));
    }

    #[test]
    fn rgb565_white_expands_to_full_white() {
        // 0xFFFF = R=11111 G=111111 B=11111 -> full white.
        let f = frame(0xFFFFu16.to_le_bytes().to_vec(), 1, 1, 2);
        let out = to_rgba8(&f, PixelFormat::Rgb565);
        assert_eq!(out.data, vec![255, 255, 255, 255]);
    }

    #[test]
    fn rgb565_pure_green_isolates_the_green_channel() {
        // G=111111, R=0, B=0 -> bits 10..5 set: 0b0000011111100000 = 0x07E0.
        let f = frame(0x07E0u16.to_le_bytes().to_vec(), 1, 1, 2);
        let out = to_rgba8(&f, PixelFormat::Rgb565);
        assert_eq!(out.data, vec![0, 255, 0, 255]);
    }

    #[test]
    fn rgb1555_black_converts_to_opaque_black() {
        let f = frame(0x0000u16.to_le_bytes().to_vec(), 1, 1, 2);
        let out = to_rgba8(&f, PixelFormat::Rgb1555);
        assert_eq!(out.data, vec![0, 0, 0, 255]);
    }

    #[test]
    fn rgb1555_pure_blue_isolates_the_blue_channel() {
        // B=11111, R=0, G=0 -> bits 4..0 set: 0x001F.
        let f = frame(0x001Fu16.to_le_bytes().to_vec(), 1, 1, 2);
        let out = to_rgba8(&f, PixelFormat::Rgb1555);
        assert_eq!(out.data, vec![0, 0, 255, 255]);
    }

    #[test]
    fn pitch_padding_is_stripped_from_the_output() {
        // 2x1 XRGB8888 frame but with an 4-byte-pixel pitch of 12 (8 bytes of
        // padding per row) — output must still be tightly packed (2*1*4 = 8
        // bytes), not carry the padding through.
        let mut data = vec![0u8; 12];
        data[0..4].copy_from_slice(&[0x00, 0x00, 0xFF, 0x00]); // pixel 0: red
        data[4..8].copy_from_slice(&[0xFF, 0x00, 0x00, 0x00]); // pixel 1: blue
        let f = frame(data, 2, 1, 12);
        let out = to_rgba8(&f, PixelFormat::Xrgb8888);
        assert_eq!(out.data.len(), 8);
        assert_eq!(&out.data[0..4], &[0xFF, 0x00, 0x00, 255]);
        assert_eq!(&out.data[4..8], &[0x00, 0x00, 0xFF, 255]);
    }

    #[test]
    fn truncated_frame_data_leaves_remaining_pixels_as_transparent_black() {
        // Claims a 2x1 frame but only ships bytes for the first pixel.
        let f = frame(vec![0x00, 0x00, 0xFF, 0x00], 2, 1, 4);
        let out = to_rgba8(&f, PixelFormat::Xrgb8888);
        assert_eq!(&out.data[0..4], &[0xFF, 0x00, 0x00, 255]);
        assert_eq!(&out.data[4..8], &[0, 0, 0, 0]);
    }
}
