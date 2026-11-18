//! Node addresses. The same strings `@we/graph-protocol` `address.ts` mints.
//!
//! `encodeURIComponent` leaves `A-Za-z0-9-_.!~*'()` and percent-encodes every
//! other UTF-8 byte, hex in uppercase. An id that contains `/` cannot forge
//! a longer address.

const SCHEME: &str = "we-graph://";

/// The key a polymorphic member carries its class under (`NODE_TYPE_KEY`).
pub const NODE_TYPE_KEY: &str = "__subjectClass";

/// The pseudo-type the schema seed gives its nodes.
pub const SCHEMA_TYPE: &str = "$schema";

fn enc(segment: &str) -> String {
    const SAFE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::new();
    for &b in segment.as_bytes() {
        if SAFE.contains(&b) {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(hex(b >> 4));
            out.push(hex(b & 0xf));
        }
    }
    out
}

fn hex(n: u8) -> char {
    b"0123456789ABCDEF"[n as usize] as char
}

fn dec(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = from_hex(bytes[i + 1])?;
            let l = from_hex(bytes[i + 2])?;
            out.push((h << 4) | l);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'A'..=b'F' => Some(b - b'A' + 10),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

pub fn entity_address(dataset: &str, ty: &str, id: &str) -> String {
    format!("{SCHEME}entity/{}/{}/{}", enc(dataset), enc(ty), enc(id))
}

pub fn property_address(dataset: &str, ty: &str, id: &str, property: &str) -> String {
    format!(
        "{SCHEME}property/{}/{}/{}/{}",
        enc(dataset),
        enc(ty),
        enc(id),
        enc(property)
    )
}

pub fn literal_address(value: &str) -> String {
    format!("{SCHEME}literal/{}", enc(value))
}

/// A parsed entity or property address. Other kinds are not read by the expanders we run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub kind: String,
    pub dataset: String,
    pub ty: String,
    pub id: String,
    pub property: Option<String>,
}

pub fn parse_address(address: &str) -> Option<Parsed> {
    let rest = address.strip_prefix(SCHEME)?;
    let mut parts = rest.split('/');
    let kind = parts.next()?;
    match kind {
        "entity" => {
            let dataset = dec(parts.next()?)?;
            let ty = dec(parts.next()?)?;
            let id = dec(parts.next()?)?;
            if parts.next().is_some() {
                return None;
            }
            Some(Parsed {
                kind: kind.into(),
                dataset,
                ty,
                id,
                property: None,
            })
        }
        "property" => {
            let dataset = dec(parts.next()?)?;
            let ty = dec(parts.next()?)?;
            let id = dec(parts.next()?)?;
            let property = dec(parts.next()?)?;
            if parts.next().is_some() {
                return None;
            }
            Some(Parsed {
                kind: kind.into(),
                dataset,
                ty,
                id,
                property: Some(property),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(enc("preview-coasys"), "preview-coasys");
        assert_eq!(enc("$schema"), "%24schema");
        assert_eq!(enc("a/b"), "a%2Fb");
        assert_eq!(enc("did:agent:mara"), "did%3Aagent%3Amara");
        assert_eq!(enc("o'clock"), "o'clock");
        assert_eq!(enc("a b"), "a%20b");
        // em dash is UTF-8 e2 80 94
        assert_eq!(enc("—"), "%E2%80%94");
    }

    #[test]
    fn entity_address_round_trips() {
        let a = entity_address("preview-coasys", "$schema", "AgentSettings");
        assert_eq!(
            a,
            "we-graph://entity/preview-coasys/%24schema/AgentSettings"
        );
        let p = parse_address(&a).unwrap();
        assert_eq!(p.ty, "$schema");
        assert_eq!(p.id, "AgentSettings");
    }
}
