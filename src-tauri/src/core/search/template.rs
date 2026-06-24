//! URL template substitution for search providers (W9).
//!
//! Replaces the `{query}` placeholder in a provider's `url_template` with a
//! percent-encoded query string. The result is a URL the UI opens in the system
//! browser — the backend **never** fetches the URL server-side.
//!
//! Encoding follows RFC 3986 unreserved characters (A-Z a-z 0-9 `-._~`).
//! Everything else, including spaces and `+`, is percent-encoded.

use crate::error::{AppError, AppResult};

/// Percent-encode a query string following RFC 3986 (unreserved chars pass
/// through; everything else is `%XX`).
fn percent_encode(query: &str) -> String {
    let mut out = String::with_capacity(query.len() * 3);
    for byte in query.bytes() {
        match byte {
            // RFC 3986 unreserved characters
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                out.push('%');
                out.push(char::from_digit((byte >> 4) as u32, 16).unwrap().to_ascii_uppercase());
                out.push(char::from_digit((byte & 0xf) as u32, 16).unwrap().to_ascii_uppercase());
            }
        }
    }
    out
}

/// Substitute `{query}` in `url_template` with the percent-encoded `query`.
///
/// Returns `Err(AppError::Validation)` if the template does not contain
/// `{query}` (callers should have validated with `provider::validate_template`
/// before persisting, but this guards the runtime substitution path too).
pub fn substitute(url_template: &str, query: &str) -> AppResult<String> {
    if !url_template.contains("{query}") {
        return Err(AppError::Validation(
            "url_template is missing the {query} placeholder".to_string(),
        ));
    }
    let encoded = percent_encode(query);
    Ok(url_template.replace("{query}", &encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_spaces_as_percent_20() {
        let result = substitute("https://example.com/search?q={query}", "super mario").unwrap();
        assert_eq!(result, "https://example.com/search?q=super%20mario");
    }

    #[test]
    fn encodes_special_chars() {
        let result = substitute("https://search.example.com/?q={query}", "Zelda & Link").unwrap();
        assert_eq!(result, "https://search.example.com/?q=Zelda%20%26%20Link");
    }

    #[test]
    fn unreserved_chars_pass_through() {
        let result = substitute("https://example.com/?q={query}", "abc-def_123.~").unwrap();
        assert_eq!(result, "https://example.com/?q=abc-def_123.~");
    }

    #[test]
    fn multiple_providers_each_encode_independently() {
        let t1 = "https://google.com/search?q={query}";
        let t2 = "https://duckduckgo.com/?q={query}";
        let query = "retro game";
        assert_eq!(
            substitute(t1, query).unwrap(),
            "https://google.com/search?q=retro%20game"
        );
        assert_eq!(
            substitute(t2, query).unwrap(),
            "https://duckduckgo.com/?q=retro%20game"
        );
    }

    #[test]
    fn malformed_template_missing_placeholder_returns_error() {
        let result = substitute("https://example.com/no-placeholder", "query");
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    fn empty_query_substitutes_empty_encoded_string() {
        let result = substitute("https://example.com/?q={query}", "").unwrap();
        assert_eq!(result, "https://example.com/?q=");
    }

    #[test]
    fn unicode_is_utf8_percent_encoded() {
        // "café" → "caf%C3%A9"
        let result = substitute("https://example.com/?q={query}", "café").unwrap();
        assert_eq!(result, "https://example.com/?q=caf%C3%A9");
    }
}
