//! No-Intro name sanitizer for the libretro-thumbnails CDN.
//!
//! The libretro-thumbnails repository follows a strict filename convention that
//! maps No-Intro game titles to safe path segments. The rules are documented at
//! <https://docs.libretro.com/guides/roms-playlists-thumbnails/> and applied here
//! before percent-encoding the result.
//!
//! Character substitutions (No-Intro → CDN path segment):
//!   `&`  → `_`
//!   `*`  → `_`
//!   `/`  → `_`
//!   `:`  → `_`
//!   `<`  → `_`
//!   `>`  → `_`
//!   `\`  → `_`
//!   `|`  → `_`
//!   `?`  → `_`
//!   `"` (double-quote) → `_`
//!
//! After substitution the segment is percent-encoded with `percent_encoding`.

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};

/// Characters that percent-encoding must escape beyond the CONTROLS baseline.
///
/// The libretro-thumbnails CDN preserves parentheses `(` `)` literally in
/// filenames (No-Intro region/revision tags use them), so we do NOT encode
/// them. Spaces encode to `%20`; accented/non-ASCII chars are escaped.
const FRAGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'+')
    .add(b',')
    .add(b';')
    .add(b'=')
    .add(b'@')
    .add(b'[')
    .add(b']');

/// Characters substituted one-for-one with `_` in No-Intro names before
/// percent-encoding, per the libretro-thumbnails filename convention.
const REPLACE_WITH_UNDERSCORE: &[char] = &['&', '*', '/', ':', '<', '>', '\\', '|', '?', '"'];

/// Sanitize a No-Intro game name into a CDN-safe, percent-encoded path segment.
///
/// Steps:
/// 1. Replace each character in [`REPLACE_WITH_UNDERSCORE`] with `_`.
/// 2. Percent-encode the result.
///
/// # Examples
/// ```
/// use harmony_lib::core::metadata::name_sanitizer::sanitize;
/// assert_eq!(sanitize("Super Mario Bros. 3 (USA)"), "Super%20Mario%20Bros.%203%20(USA)");
/// assert_eq!(sanitize("Tom & Jerry: War of the Whiskers (USA)"), "Tom%20_%20Jerry_%20War%20of%20the%20Whiskers%20(USA)");
/// ```
pub fn sanitize(name: &str) -> String {
    let substituted: String = name
        .chars()
        .map(|c| {
            if REPLACE_WITH_UNDERSCORE.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    utf8_percent_encode(&substituted, FRAGMENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_name_percent_encodes_space() {
        assert_eq!(
            sanitize("Super Mario Bros. 3 (USA)"),
            "Super%20Mario%20Bros.%203%20(USA)"
        );
    }

    #[test]
    fn ampersand_becomes_underscore() {
        let result = sanitize("Tom & Jerry: War of the Whiskers (USA)");
        assert!(!result.contains('&'), "ampersand must be replaced");
        assert!(!result.contains(':'), "colon must be replaced");
    }

    #[test]
    fn colon_becomes_underscore() {
        let result = sanitize("Castlevania: Symphony of the Night (USA)");
        assert!(!result.contains(':'));
        assert!(result.contains('_'));
    }

    #[test]
    fn slash_becomes_underscore() {
        let result = sanitize("AC/DC Live: Rock Band Track Pack (USA)");
        assert!(!result.contains('/'));
    }

    #[test]
    fn all_special_chars_substituted() {
        let result = sanitize("A & B * C / D : E < F > G \\ H | I ? J \" K");
        for ch in ['&', '*', '/', ':', '<', '>', '\\', '|', '?', '"'] {
            assert!(
                !result.contains(ch),
                "char {:?} should have been substituted",
                ch
            );
        }
    }

    #[test]
    fn no_intro_name_with_region_tag() {
        // Typical No-Intro format: "Title (Region) (Revision)"
        let name = "Donkey Kong Country 2 - Diddy's Kong Quest (USA)";
        let result = sanitize(name);
        // Apostrophe is not in the substitute list — it should remain or be encoded
        assert!(!result.contains(' '), "spaces must be percent-encoded");
    }

    #[test]
    fn name_with_question_mark() {
        let result = sanitize("Who Wants to Be a Millionaire? (USA)");
        assert!(!result.contains('?'));
    }
}
