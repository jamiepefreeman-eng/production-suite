//! Minimal OSC 1.0 encode/decode (int32, float32, string) — enough for X32/X Air.

#[derive(Debug, Clone, PartialEq)]
pub enum OscArg {
    Int(i32),
    Float(f32),
    Str(String),
}

fn pad_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

pub fn encode(address: &str, args: &[OscArg]) -> Vec<u8> {
    let mut out = Vec::new();
    pad_str(&mut out, address);
    let mut tags = String::from(",");
    for a in args {
        tags.push(match a {
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
            OscArg::Str(_) => 's',
        });
    }
    pad_str(&mut out, &tags);
    for a in args {
        match a {
            OscArg::Int(i) => out.extend_from_slice(&i.to_be_bytes()),
            OscArg::Float(f) => out.extend_from_slice(&f.to_be_bytes()),
            OscArg::Str(s) => pad_str(&mut out, s),
        }
    }
    out
}

fn read_str(buf: &[u8], pos: &mut usize) -> Option<String> {
    let start = *pos;
    let end = start + buf.get(start..)?.iter().position(|&b| b == 0)?;
    let s = std::str::from_utf8(&buf[start..end]).ok()?.to_string();
    *pos = (end + 4) & !3;
    Some(s)
}

pub fn decode(buf: &[u8]) -> Option<(String, Vec<OscArg>)> {
    let mut pos = 0;
    let addr = read_str(buf, &mut pos)?;
    if pos >= buf.len() {
        return Some((addr, vec![]));
    }
    let tags = read_str(buf, &mut pos)?;
    let mut args = Vec::new();
    for t in tags.chars().skip(1) {
        match t {
            'i' => {
                let b = buf.get(pos..pos + 4)?;
                args.push(OscArg::Int(i32::from_be_bytes([b[0], b[1], b[2], b[3]])));
                pos += 4;
            }
            'f' => {
                let b = buf.get(pos..pos + 4)?;
                args.push(OscArg::Float(f32::from_be_bytes([b[0], b[1], b[2], b[3]])));
                pos += 4;
            }
            's' => args.push(OscArg::Str(read_str(buf, &mut pos)?)),
            'b' => {
                // blob: length + bytes (used by X32 meters) — skipped here
                let b = buf.get(pos..pos + 4)?;
                let n = i32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize;
                pos = (pos + 4 + n + 3) & !3;
            }
            _ => return None,
        }
    }
    Some((addr, args))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_known_bytes() {
        let p = encode("/ch/01/mix/on", &[OscArg::Int(0)]);
        // "/ch/01/mix/on\0\0\0" (16) + ",i\0\0" (4) + int (4)
        assert_eq!(p.len(), 24);
        assert_eq!(&p[16..20], b",i\0\0");
        assert_eq!(&p[20..24], &[0, 0, 0, 0]);
        let (a, args) = decode(&p).unwrap();
        assert_eq!(a, "/ch/01/mix/on");
        assert_eq!(args, vec![OscArg::Int(0)]);
    }

    #[test]
    fn float_and_string_roundtrip() {
        let p = encode("/x", &[OscArg::Float(0.75), OscArg::Str("hi".into())]);
        assert_eq!(p.len() % 4, 0);
        let (_, args) = decode(&p).unwrap();
        assert_eq!(args, vec![OscArg::Float(0.75), OscArg::Str("hi".into())]);
    }
}
