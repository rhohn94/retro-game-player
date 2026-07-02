//! Provider API auto-discovery (v0.25 "Scout", W250).
//!
//! Given a site **base URL**, probe a ranked set of discovery mechanisms and
//! return search-capability candidates — each a ready-to-use `{query}` URL
//! template plus the mechanism that found it. Mechanisms, best first:
//!
//! 1. **OpenSearch description** — `<link rel="search"
//!    type="application/opensearchdescription+xml">` on the homepage, with a
//!    `/opensearch.xml` well-known fallback. The description's `<Url>`
//!    templates use `{searchTerms}`; Harmony rewrites to `{query}` and
//!    prefers `text/html` templates (its scraper consumes HTML result pages).
//! 2. **MediaWiki** — `/api.php?action=opensearch` answering JSON ⇒ the
//!    site's HTML search page `…/index.php?search={query}`.
//! 3. **WordPress** — `/wp-json/` answering JSON ⇒ `/?s={query}`.
//! 4. **HTML search form** — a GET `<form>` on the homepage with a
//!    text/search input ⇒ a template synthesized from the form action + input
//!    name, preserving hidden fields.
//!
//! Discovery starts from a user-supplied URL and only ever fetches that
//! site's own pages over the `fetch.rs` safeguards — it is not (and must
//! never become) an open-web provider crawler. Design:
//! docs/design/provider-discovery-design.md.

use super::fetch::fetch_body;
use crate::error::{AppError, AppResult};
use scraper::{Html, Selector};
use serde::Serialize;

/// How a candidate was discovered — ranking, best first, follows the enum
/// order (OpenSearch is the standards path; a parsed form is the weakest).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mechanism {
    OpenSearch,
    MediaWiki,
    WordPress,
    SearchForm,
}

/// One discovered search capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub mechanism: Mechanism,
    /// The site's own name for itself, when the mechanism supplies one
    /// (OpenSearch `<ShortName>`).
    pub name: Option<String>,
    /// Ready-to-store provider template containing `{query}`.
    pub url_template: String,
    /// One-line human note ("OpenSearch description at …").
    pub note: String,
}

/// Normalizes a user-typed base URL: requires http(s) (https assumed when no
/// scheme is given), strips query/fragment, keeps the path.
pub fn normalize_base(input: &str) -> AppResult<reqwest::Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("enter a site URL to discover".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = reqwest::Url::parse(&with_scheme)
        .map_err(|e| AppError::Validation(format!("not a valid URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Validation(format!(
            "discovery supports only http(s) sites, not {}",
            url.scheme()
        )));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Runs every mechanism against `base_url` and returns candidates ranked
/// best-first (mechanism order, then discovery order). Individual mechanism
/// failures are skipped — an unreachable `/wp-json/` must not sink an
/// OpenSearch hit; an empty result is the honest "nothing discovered".
pub fn discover(base_url: &str) -> AppResult<Vec<Discovered>> {
    let base = normalize_base(base_url)?;
    let mut found: Vec<Discovered> = Vec::new();

    // The homepage feeds two mechanisms (OpenSearch link + form parse); a
    // fetch failure here still lets the well-known/API probes run.
    let homepage = fetch_body(base.as_str()).ok();

    // 1. OpenSearch: homepage <link rel=search>, then /opensearch.xml.
    let mut osd_urls: Vec<String> = Vec::new();
    if let Some(html) = &homepage {
        osd_urls.extend(opensearch_links(html, &base));
    }
    if let Ok(well_known) = base.join("/opensearch.xml") {
        osd_urls.push(well_known.to_string());
    }
    osd_urls.dedup();
    for osd_url in osd_urls {
        if let Ok(body) = fetch_body(&osd_url) {
            for candidate in parse_opensearch_description(&body, &osd_url) {
                push_unique(&mut found, candidate);
            }
        }
        if found.iter().any(|c| c.mechanism == Mechanism::OpenSearch) {
            break; // one description is authoritative; don't refetch variants
        }
    }

    // 2. MediaWiki.
    if let Some(candidate) = probe_mediawiki(&base) {
        push_unique(&mut found, candidate);
    }

    // 3. WordPress.
    if let Some(candidate) = probe_wordpress(&base) {
        push_unique(&mut found, candidate);
    }

    // 4. Homepage search form.
    if let Some(html) = &homepage {
        for candidate in forms_to_templates(html, &base) {
            push_unique(&mut found, candidate);
        }
    }

    found.sort_by(|a, b| a.mechanism.cmp(&b.mechanism));
    Ok(found)
}

/// Appends `candidate` unless an equal template was already found (a form
/// frequently mirrors the OpenSearch template — report it once, best rank).
fn push_unique(found: &mut Vec<Discovered>, candidate: Discovered) {
    if !found.iter().any(|c| c.url_template == candidate.url_template) {
        found.push(candidate);
    }
}

/// `<link rel="search" type="application/opensearchdescription+xml">` hrefs
/// on a page, resolved absolute.
pub fn opensearch_links(html: &str, base: &reqwest::Url) -> Vec<String> {
    let doc = Html::parse_document(html);
    let selector = Selector::parse(r#"link[rel~="search"]"#).expect("static selector");
    doc.select(&selector)
        .filter(|el| {
            el.value()
                .attr("type")
                .is_some_and(|t| t.contains("opensearchdescription"))
        })
        .filter_map(|el| el.value().attr("href"))
        .filter_map(|href| base.join(href).ok())
        .map(|u| u.to_string())
        .collect()
}

/// Parses an OpenSearch description document into candidates. Prefers
/// `text/html` `<Url>` templates (directly consumable by Harmony's HTML
/// scraper); other types are skipped. `{searchTerms}` becomes `{query}`;
/// optional OpenSearch parameters (`{startPage?}` etc.) are dropped.
pub fn parse_opensearch_description(xml: &str, source_url: &str) -> Vec<Discovered> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut short_name: Option<String> = None;
    let mut templates: Vec<String> = Vec::new();
    let mut in_short_name = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if local_name(e.name().as_ref()) == b"ShortName" => {
                in_short_name = true;
            }
            Ok(Event::Text(t)) if in_short_name => {
                short_name = Some(t.unescape().unwrap_or_default().trim().to_string());
                in_short_name = false;
            }
            Ok(Event::End(e)) if local_name(e.name().as_ref()) == b"ShortName" => {
                in_short_name = false;
            }
            Ok(Event::Start(e)) | Ok(Event::Empty(e))
                if local_name(e.name().as_ref()) == b"Url" =>
            {
                let mut template = None;
                let mut kind = None;
                for attr in e.attributes().flatten() {
                    // Unescape XML entities (`&amp;` → `&`) so the stored
                    // template is a usable URL, not double-encoded.
                    let value = attr
                        .unescape_value()
                        .map(|v| v.into_owned())
                        .unwrap_or_else(|_| String::from_utf8_lossy(&attr.value).into_owned());
                    match attr.key.as_ref() {
                        b"template" => template = Some(value),
                        b"type" => kind = Some(value),
                        _ => {}
                    }
                }
                if let (Some(template), Some(kind)) = (template, kind) {
                    if kind.eq_ignore_ascii_case("text/html") {
                        templates.push(template);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Vec::new(), // not a parseable description
            _ => {}
        }
    }
    templates
        .into_iter()
        .filter_map(|t| open_search_template_to_query(&t))
        .map(|url_template| Discovered {
            mechanism: Mechanism::OpenSearch,
            name: short_name.clone(),
            url_template,
            note: format!("OpenSearch description at {source_url}"),
        })
        .collect()
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|&b| b == b':').next().unwrap_or(name)
}

/// `{searchTerms}` → `{query}`; optional `{param?}` placeholders are removed.
/// Returns `None` when no `{searchTerms}` is present (unusable template).
pub fn open_search_template_to_query(template: &str) -> Option<String> {
    if !template.contains("{searchTerms}") {
        return None;
    }
    let with_query = template.replace("{searchTerms}", "{query}");
    // Strip OpenSearch optional parameters — any `{name?}` placeholder — while
    // leaving the real `{query}` slot intact. Scan brace-delimited spans.
    let mut out = String::with_capacity(with_query.len());
    let mut rest = with_query.as_str();
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open..];
        match after.find('}') {
            Some(close) => {
                let token = &after[1..close]; // between the braces
                if token.ends_with('?') {
                    // optional param — drop the whole `{…?}`
                } else {
                    out.push_str(&after[..=close]); // keep `{query}` etc.
                }
                rest = &after[close + 1..];
            }
            None => {
                out.push_str(after); // unbalanced brace — leave as-is
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    Some(out)
}

/// MediaWiki probe: `/api.php?action=opensearch` answering JSON marks a wiki;
/// the stored template is the wiki's *HTML* search page.
fn probe_mediawiki(base: &reqwest::Url) -> Option<Discovered> {
    let api = base.join("api.php").ok()?;
    let probe = format!("{api}?action=opensearch&search=test&format=json&limit=1");
    let body = fetch_body(&probe).ok()?;
    let looks_json = body.trim_start().starts_with('[');
    if !looks_json {
        return None;
    }
    let search = base.join("index.php").ok()?;
    Some(Discovered {
        mechanism: Mechanism::MediaWiki,
        name: None,
        url_template: format!("{search}?search={{query}}"),
        note: format!("MediaWiki opensearch API at {api}"),
    })
}

/// WordPress probe: `/wp-json/` answering JSON marks a WP site; the stored
/// template is the classic `/?s=` HTML search.
fn probe_wordpress(base: &reqwest::Url) -> Option<Discovered> {
    let api = base.join("wp-json/").ok()?;
    let body = fetch_body(api.as_str()).ok()?;
    if !body.trim_start().starts_with('{') {
        return None;
    }
    let origin = base.join("/").ok()?;
    Some(Discovered {
        mechanism: Mechanism::WordPress,
        name: None,
        url_template: format!("{origin}?s={{query}}"),
        note: format!("WordPress REST root at {api}"),
    })
}

/// GET search forms on a page → synthesized templates: resolved action +
/// the text/search input as `{query}`, hidden inputs preserved as-is.
pub fn forms_to_templates(html: &str, base: &reqwest::Url) -> Vec<Discovered> {
    let doc = Html::parse_document(html);
    let form_sel = Selector::parse("form").expect("static selector");
    let input_sel = Selector::parse("input").expect("static selector");
    let mut out = Vec::new();
    for form in doc.select(&form_sel) {
        let method = form.value().attr("method").unwrap_or("get");
        if !method.eq_ignore_ascii_case("get") {
            continue;
        }
        let action = form.value().attr("action").unwrap_or("");
        let Ok(action_url) = base.join(action) else { continue };
        let mut query_name: Option<String> = None;
        let mut fixed: Vec<(String, String)> = Vec::new();
        for input in form.select(&input_sel) {
            let v = input.value();
            let Some(name) = v.attr("name").filter(|n| !n.is_empty()) else { continue };
            match v.attr("type").unwrap_or("text").to_ascii_lowercase().as_str() {
                "search" | "text" => {
                    if query_name.is_none() {
                        query_name = Some(name.to_string());
                    }
                }
                "hidden" => {
                    fixed.push((name.to_string(), v.attr("value").unwrap_or("").to_string()));
                }
                _ => {}
            }
        }
        let Some(query_name) = query_name else { continue };
        let mut pairs: Vec<String> = fixed
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        pairs.push(format!("{query_name}={{query}}"));
        let mut template = action_url.to_string();
        template.push(if action_url.query().is_some() { '&' } else { '?' });
        template.push_str(&pairs.join("&"));
        out.push(Discovered {
            mechanism: Mechanism::SearchForm,
            name: None,
            url_template: template,
            note: format!("search form on {base}"),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn normalize_accepts_bare_domains_and_rejects_bad_schemes() {
        assert_eq!(normalize_base("example.com").unwrap().as_str(), "https://example.com/");
        assert_eq!(
            normalize_base("http://example.com/wiki?x=1#f").unwrap().as_str(),
            "http://example.com/wiki"
        );
        assert!(normalize_base("ftp://example.com").is_err());
        assert!(normalize_base("   ").is_err());
    }

    #[test]
    fn finds_opensearch_link_tags() {
        let html = r#"<html><head>
            <link rel="search" type="application/opensearchdescription+xml" href="/osd.xml" title="Search">
            <link rel="stylesheet" href="/x.css">
        </head></html>"#;
        let links = opensearch_links(html, &base("https://example.com"));
        assert_eq!(links, vec!["https://example.com/osd.xml"]);
    }

    #[test]
    fn parses_an_opensearch_description_to_a_query_template() {
        let xml = r#"<?xml version="1.0"?>
            <OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
              <ShortName>ExampleSearch</ShortName>
              <Url type="application/atom+xml" template="https://example.com/atom?q={searchTerms}"/>
              <Url type="text/html" template="https://example.com/search?q={searchTerms}&amp;page={startPage?}"/>
            </OpenSearchDescription>"#;
        let found = parse_opensearch_description(xml, "https://example.com/osd.xml");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name.as_deref(), Some("ExampleSearch"));
        assert_eq!(found[0].url_template, "https://example.com/search?q={query}&page=");
        assert_eq!(found[0].mechanism, Mechanism::OpenSearch);
    }

    #[test]
    fn opensearch_template_conversion_requires_search_terms() {
        assert_eq!(
            open_search_template_to_query("https://x/s?q={searchTerms}"),
            Some("https://x/s?q={query}".to_string())
        );
        assert!(open_search_template_to_query("https://x/s?q=fixed").is_none());
    }

    #[test]
    fn synthesizes_a_template_from_a_get_search_form() {
        let html = r#"<form action="/find" method="get">
            <input type="hidden" name="cat" value="games">
            <input type="search" name="q" placeholder="Search…">
        </form>"#;
        let found = forms_to_templates(html, &base("https://example.com"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].url_template, "https://example.com/find?cat=games&q={query}");
        assert_eq!(found[0].mechanism, Mechanism::SearchForm);
    }

    #[test]
    fn skips_post_forms_and_forms_without_text_inputs() {
        let html = r#"
            <form action="/login" method="post"><input type="text" name="user"></form>
            <form action="/newsletter" method="get"><input type="email" name="email"></form>"#;
        assert!(forms_to_templates(html, &base("https://example.com")).is_empty());
    }

    // --- End-to-end against a local fixture site -----------------------------

    /// Serves a tiny site: homepage with an OpenSearch link + a search form,
    /// the description XML, and a MediaWiki-style api.php.
    fn fixture_site() -> (u16, std::thread::JoinHandle<()>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = std::thread::spawn(move || {
            // Serve until the test's discover() run stops asking (bounded).
            for _ in 0..16 {
                let Ok(request) = server.recv_timeout(std::time::Duration::from_secs(2)) else {
                    break;
                };
                let Some(request) = request else { break };
                let url = request.url().to_string();
                let path = url.split('?').next().unwrap_or("");
                let (status, body): (u16, String) = match path {
                    "/" => (
                        200,
                        r#"<html><head>
                            <link rel="search" type="application/opensearchdescription+xml" href="/osd.xml">
                          </head><body>
                            <form action="/find" method="get"><input type="search" name="q"></form>
                          </body></html>"#
                            .to_string(),
                    ),
                    "/osd.xml" => (
                        200,
                        r#"<OpenSearchDescription><ShortName>FixtureSite</ShortName>
                           <Url type="text/html" template="{BASE}/search?q={searchTerms}"/>
                           </OpenSearchDescription>"#
                            .replace("{BASE}", &format!("http://127.0.0.1:{}", 0)), // port irrelevant for assertion
                    ),
                    "/api.php" => (200, r#"["test",[],[],[]]"#.to_string()),
                    _ => (404, "nope".to_string()),
                };
                let _ = request.respond(
                    tiny_http::Response::from_string(body).with_status_code(status),
                );
            }
        });
        (port, handle)
    }

    #[test]
    fn discovers_all_mechanisms_on_the_fixture_site_ranked() {
        let (port, _handle) = fixture_site();
        let found = discover(&format!("http://127.0.0.1:{port}")).unwrap();
        let mechanisms: Vec<Mechanism> = found.iter().map(|c| c.mechanism).collect();
        assert!(mechanisms.contains(&Mechanism::OpenSearch), "{found:?}");
        assert!(mechanisms.contains(&Mechanism::MediaWiki), "{found:?}");
        assert!(mechanisms.contains(&Mechanism::SearchForm), "{found:?}");
        // Ranked: OpenSearch first, form last.
        assert_eq!(mechanisms.first(), Some(&Mechanism::OpenSearch));
        assert_eq!(mechanisms.last(), Some(&Mechanism::SearchForm));
        let os = &found[0];
        assert_eq!(os.name.as_deref(), Some("FixtureSite"));
        assert!(os.url_template.ends_with("/search?q={query}"), "{}", os.url_template);
    }

    /// Manual, network-hitting verification against a real provider that
    /// adheres to a supported API shape: Wikipedia publishes an OpenSearch
    /// description (linked from its homepage), so pointing discovery at just
    /// its base URL must programmatically recover a `{query}` HTML search
    /// template. Not run by `cargo test`:
    ///
    /// ```text
    /// cargo test -p harmony manual_discovers_wikipedia -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore]
    fn manual_discovers_wikipedia_from_its_base_url() {
        let found = discover("https://en.wikipedia.org").expect("discovery failed");
        println!("discovered: {found:#?}");
        let opensearch = found
            .iter()
            .find(|c| c.mechanism == Mechanism::OpenSearch)
            .expect("expected an OpenSearch capability for wikipedia.org");
        assert!(
            opensearch.url_template.contains("{query}"),
            "template must carry the query slot: {}",
            opensearch.url_template
        );
        assert!(
            opensearch.url_template.starts_with("https://"),
            "template must be an absolute https URL: {}",
            opensearch.url_template
        );
    }
}
