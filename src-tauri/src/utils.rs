use std::collections::HashMap;

pub fn build_cookie_header(cookies: &HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn parse_set_cookies(headers: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for header in headers {
        if let Some(cookie_part) = header.split(';').next() {
            if let Some(eq) = cookie_part.find('=') {
                map.insert(
                    cookie_part[..eq].trim().to_string(),
                    cookie_part[eq + 1..].trim().to_string(),
                );
            }
        }
    }
    map
}
