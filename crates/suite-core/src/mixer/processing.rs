//! Per-channel settings beyond fader/mute: high-pass filter, 4-band EQ, gate,
//! compressor, pan and name — in real units (Hz, dB, ms, ratio).
//!
//! Midas M32 / Behringer X32 and Behringer X Air share these OSC addresses and
//! value scalings (from the community "Unofficial X32/M32 OSC Remote Protocol"
//! document and the X Air equivalent). The desk takes and returns normalised
//! floats 0..1 (linear or logarithmic over the range below) or integer enums;
//! the functions here convert both ways so nothing outside this file deals in
//! 0..1 values.
//!
//! Allen & Heath SQ / Avantis: their public MIDI protocols don't expose EQ or
//! dynamics, so only `Fader` / `Mute` are sent to them.

use super::osc::{encode, OscArg};

pub const EQ_BANDS: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum EqType {
    LowCut,
    LowShelf,
    Peq,
    /// "Vintage" PEQ.
    Veq,
    HighShelf,
    HighCut,
}

impl EqType {
    pub const ALL: [EqType; 6] = [EqType::LowCut, EqType::LowShelf, EqType::Peq, EqType::Veq, EqType::HighShelf, EqType::HighCut];
    fn index(self) -> i32 {
        Self::ALL.iter().position(|t| *t == self).unwrap() as i32
    }
}

/// Compressor ratios the desk offers (enum index 0..=11).
pub const COMP_RATIOS: [f32; 12] = [1.1, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0, 20.0, 100.0];

/// One setting on one input channel.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "param", rename_all = "snake_case"))]
pub enum ChannelParam {
    /// 0..1 of fader travel (see `fader_to_db`).
    Fader { level: f32 },
    Mute { muted: bool },
    /// -1 (left) .. 1 (right).
    Pan { pan: f32 },
    Name { name: String },
    HpfOn { on: bool },
    /// 20..400 Hz.
    HpfFreq { hz: f32 },
    EqOn { on: bool },
    /// `band` is 1..=4.
    EqType { band: u8, kind: EqType },
    /// 20..20000 Hz.
    EqFreq { band: u8, hz: f32 },
    /// -15..15 dB.
    EqGain { band: u8, db: f32 },
    /// 0.3..10.
    EqQ { band: u8, q: f32 },
    GateOn { on: bool },
    /// -80..0 dB.
    GateThreshold { db: f32 },
    /// 3..60 dB.
    GateRange { db: f32 },
    /// 0..120 ms.
    GateAttack { ms: f32 },
    /// 0.02..2000 ms.
    GateHold { ms: f32 },
    /// 5..4000 ms.
    GateRelease { ms: f32 },
    CompOn { on: bool },
    /// -60..0 dB.
    CompThreshold { db: f32 },
    /// Snaps to the nearest of `COMP_RATIOS`.
    CompRatio { ratio: f32 },
    /// 0..5 dB.
    CompKnee { db: f32 },
    /// Make-up gain 0..24 dB.
    CompMakeup { db: f32 },
    /// 0..120 ms.
    CompAttack { ms: f32 },
    /// 0.02..2000 ms.
    CompHold { ms: f32 },
    /// 5..4000 ms.
    CompRelease { ms: f32 },
}

/// A channel setting reported by the desk.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChannelUpdate {
    pub channel: u8,
    pub param: ChannelParam,
}

// ── Scalings ───────────────────────────────────────────────────────────────

fn lin(v: f32, lo: f32, hi: f32) -> f32 {
    ((v - lo) / (hi - lo)).clamp(0.0, 1.0)
}
fn lin_inv(x: f32, lo: f32, hi: f32) -> f32 {
    lo + x.clamp(0.0, 1.0) * (hi - lo)
}
/// Logarithmic: works for decreasing ranges too (EQ Q is 10 at 0, 0.3 at 1).
fn log(v: f32, lo: f32, hi: f32) -> f32 {
    let v = v.clamp(lo.min(hi), lo.max(hi));
    ((v / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}
fn log_inv(x: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(x.clamp(0.0, 1.0))
}

/// X32 / X Air fader position (0..1) to dB. `None` = -∞ (fader at the bottom).
pub fn fader_to_db(f: f32) -> Option<f32> {
    let f = f.clamp(0.0, 1.0);
    if f <= 0.0 {
        None
    } else if f >= 0.5 {
        Some(f * 40.0 - 30.0)
    } else if f >= 0.25 {
        Some(f * 80.0 - 50.0)
    } else if f >= 0.0625 {
        Some(f * 160.0 - 70.0)
    } else {
        Some(f * 480.0 - 90.0)
    }
}

fn nearest_ratio_index(r: f32) -> i32 {
    COMP_RATIOS
        .iter()
        .enumerate()
        .min_by(|a, b| (a.1 - r).abs().total_cmp(&(b.1 - r).abs()))
        .map(|(i, _)| i as i32)
        .unwrap_or(0)
}

fn band_ok(b: u8) -> bool {
    (1..=EQ_BANDS).contains(&b)
}

// ── X32 / X Air OSC ────────────────────────────────────────────────────────

/// `(address suffix after /ch/NN/, value)` for one setting, or `None` if the
/// band number is out of range.
fn osc_parts(p: &ChannelParam) -> Option<(String, OscArg)> {
    use ChannelParam::*;
    use OscArg::{Float as F, Int as I};
    let b = |on: bool| I(on as i32);
    Some(match p {
        Fader { level } => ("mix/fader".into(), F(level.clamp(0.0, 1.0))),
        Mute { muted } => ("mix/on".into(), I(!muted as i32)),
        Pan { pan } => ("mix/pan".into(), F(lin(*pan, -1.0, 1.0))),
        Name { name } => ("config/name".into(), OscArg::Str(name.chars().take(12).collect())),
        HpfOn { on } => ("preamp/hpon".into(), b(*on)),
        HpfFreq { hz } => ("preamp/hpf".into(), F(log(*hz, 20.0, 400.0))),
        EqOn { on } => ("eq/on".into(), b(*on)),
        EqType { band, kind } if band_ok(*band) => (format!("eq/{band}/type"), I(kind.index())),
        EqFreq { band, hz } if band_ok(*band) => (format!("eq/{band}/f"), F(log(*hz, 20.0, 20000.0))),
        EqGain { band, db } if band_ok(*band) => (format!("eq/{band}/g"), F(lin(*db, -15.0, 15.0))),
        EqQ { band, q } if band_ok(*band) => (format!("eq/{band}/q"), F(log(*q, 10.0, 0.3))),
        EqType { .. } | EqFreq { .. } | EqGain { .. } | EqQ { .. } => return None,
        GateOn { on } => ("gate/on".into(), b(*on)),
        GateThreshold { db } => ("gate/thr".into(), F(lin(*db, -80.0, 0.0))),
        GateRange { db } => ("gate/range".into(), F(lin(*db, 3.0, 60.0))),
        GateAttack { ms } => ("gate/attack".into(), F(lin(*ms, 0.0, 120.0))),
        GateHold { ms } => ("gate/hold".into(), F(log(*ms, 0.02, 2000.0))),
        GateRelease { ms } => ("gate/release".into(), F(log(*ms, 5.0, 4000.0))),
        CompOn { on } => ("dyn/on".into(), b(*on)),
        CompThreshold { db } => ("dyn/thr".into(), F(lin(*db, -60.0, 0.0))),
        CompRatio { ratio } => ("dyn/ratio".into(), I(nearest_ratio_index(*ratio))),
        CompKnee { db } => ("dyn/knee".into(), F(lin(*db, 0.0, 5.0))),
        CompMakeup { db } => ("dyn/mgain".into(), F(lin(*db, 0.0, 24.0))),
        CompAttack { ms } => ("dyn/attack".into(), F(lin(*ms, 0.0, 120.0))),
        CompHold { ms } => ("dyn/hold".into(), F(log(*ms, 0.02, 2000.0))),
        CompRelease { ms } => ("dyn/release".into(), F(log(*ms, 5.0, 4000.0))),
    })
}

fn ch(n: u8) -> String {
    format!("{:02}", n.max(1))
}

pub fn osc_set(channel: u8, p: &ChannelParam) -> Vec<Vec<u8>> {
    osc_parts(p)
        .map(|(suffix, arg)| vec![encode(&format!("/ch/{}/{suffix}", ch(channel)), &[arg])])
        .unwrap_or_default()
}

/// Every address the channel view shows. Sending an address with no
/// arguments makes the desk reply with its current value.
pub fn query_suffixes() -> Vec<String> {
    let mut v: Vec<String> = [
        "mix/fader", "mix/on", "mix/pan", "config/name", "preamp/hpon", "preamp/hpf", "eq/on", "gate/on", "gate/thr",
        "gate/range", "gate/attack", "gate/hold", "gate/release", "dyn/on", "dyn/thr", "dyn/ratio", "dyn/knee",
        "dyn/mgain", "dyn/attack", "dyn/hold", "dyn/release",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    for b in 1..=EQ_BANDS {
        for k in ["type", "f", "g", "q"] {
            v.push(format!("eq/{b}/{k}"));
        }
    }
    v
}

pub fn osc_query(channel: u8) -> Vec<Vec<u8>> {
    query_suffixes().iter().map(|s| encode(&format!("/ch/{}/{s}", ch(channel)), &[])).collect()
}

/// Turn a reply / live change from the desk back into a typed setting.
pub fn osc_decode(address: &str, args: &[OscArg]) -> Option<ChannelUpdate> {
    use ChannelParam::*;
    let rest = address.strip_prefix("/ch/")?;
    let (num, suffix) = rest.split_once('/')?;
    let channel: u8 = num.parse().ok()?;
    let arg = args.first()?;
    let f = || match arg {
        OscArg::Float(x) => Some(*x),
        OscArg::Int(i) => Some(*i as f32),
        _ => None,
    };
    let i = || match arg {
        OscArg::Int(i) => Some(*i),
        OscArg::Float(x) => Some(x.round() as i32),
        _ => None,
    };
    let on = || i().map(|v| v != 0);
    let param = match suffix {
        "mix/fader" => Fader { level: f()? },
        "mix/on" => Mute { muted: !on()? },
        "mix/pan" => Pan { pan: lin_inv(f()?, -1.0, 1.0) },
        "config/name" => match arg {
            OscArg::Str(s) => Name { name: s.clone() },
            _ => return None,
        },
        "preamp/hpon" => HpfOn { on: on()? },
        "preamp/hpf" => HpfFreq { hz: log_inv(f()?, 20.0, 400.0) },
        "eq/on" => EqOn { on: on()? },
        "gate/on" => GateOn { on: on()? },
        "gate/thr" => GateThreshold { db: lin_inv(f()?, -80.0, 0.0) },
        "gate/range" => GateRange { db: lin_inv(f()?, 3.0, 60.0) },
        "gate/attack" => GateAttack { ms: lin_inv(f()?, 0.0, 120.0) },
        "gate/hold" => GateHold { ms: log_inv(f()?, 0.02, 2000.0) },
        "gate/release" => GateRelease { ms: log_inv(f()?, 5.0, 4000.0) },
        "dyn/on" => CompOn { on: on()? },
        "dyn/thr" => CompThreshold { db: lin_inv(f()?, -60.0, 0.0) },
        "dyn/ratio" => CompRatio { ratio: *COMP_RATIOS.get(i()?.clamp(0, 11) as usize)? },
        "dyn/knee" => CompKnee { db: lin_inv(f()?, 0.0, 5.0) },
        "dyn/mgain" => CompMakeup { db: lin_inv(f()?, 0.0, 24.0) },
        "dyn/attack" => CompAttack { ms: lin_inv(f()?, 0.0, 120.0) },
        "dyn/hold" => CompHold { ms: log_inv(f()?, 0.02, 2000.0) },
        "dyn/release" => CompRelease { ms: log_inv(f()?, 5.0, 4000.0) },
        s => {
            let s = s.strip_prefix("eq/")?;
            let (b, k) = s.split_once('/')?;
            let band: u8 = b.parse().ok().filter(|b| band_ok(*b))?;
            match k {
                "type" => EqType { band, kind: *self::EqType::ALL.get(i()?.clamp(0, 5) as usize)? },
                "f" => EqFreq { band, hz: log_inv(f()?, 20.0, 20000.0) },
                "g" => EqGain { band, db: lin_inv(f()?, -15.0, 15.0) },
                "q" => EqQ { band, q: log_inv(f()?, 10.0, 0.3) },
                _ => return None,
            }
        }
    };
    Some(ChannelUpdate { channel, param })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mixer::osc::decode;

    fn sent(channel: u8, p: ChannelParam) -> (String, OscArg) {
        let pk = osc_set(channel, &p);
        assert_eq!(pk.len(), 1, "{p:?}");
        let (a, mut args) = decode(&pk[0]).unwrap();
        (a, args.remove(0))
    }

    fn close(a: f32, b: f32, tol: f32) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn known_x32_values() {
        // Reference points from the X32 OSC protocol tables.
        let (a, v) = sent(5, ChannelParam::EqFreq { band: 2, hz: 632.5 });
        assert_eq!(a, "/ch/05/eq/2/f");
        assert!(matches!(v, OscArg::Float(x) if close(x, 0.5, 0.001)), "{v:?}"); // 20*1000^0.5 ≈ 632 Hz
        let (_, v) = sent(1, ChannelParam::EqGain { band: 1, db: 0.0 });
        assert_eq!(v, OscArg::Float(0.5));
        let (_, v) = sent(1, ChannelParam::EqQ { band: 1, q: 10.0 });
        assert_eq!(v, OscArg::Float(0.0)); // Q runs backwards: wide = 0
        let (_, v) = sent(1, ChannelParam::EqQ { band: 1, q: 0.3 });
        assert!(matches!(v, OscArg::Float(x) if close(x, 1.0, 1e-5)));
        let (a, v) = sent(1, ChannelParam::HpfFreq { hz: 400.0 });
        assert_eq!(a, "/ch/01/preamp/hpf");
        assert!(matches!(v, OscArg::Float(x) if close(x, 1.0, 1e-5)));
        let (_, v) = sent(1, ChannelParam::GateThreshold { db: -40.0 });
        assert_eq!(v, OscArg::Float(0.5));
        let (a, v) = sent(12, ChannelParam::CompRatio { ratio: 4.0 });
        assert_eq!((a.as_str(), v), ("/ch/12/dyn/ratio", OscArg::Int(6)));
        let (_, v) = sent(1, ChannelParam::CompRatio { ratio: 3.3 });
        assert_eq!(v, OscArg::Int(5)); // snaps to 3.0
        let (a, v) = sent(1, ChannelParam::Mute { muted: true });
        assert_eq!((a.as_str(), v), ("/ch/01/mix/on", OscArg::Int(0)));
        let (_, v) = sent(1, ChannelParam::EqType { band: 1, kind: EqType::LowShelf });
        assert_eq!(v, OscArg::Int(1));
        assert!(osc_set(1, &ChannelParam::EqGain { band: 5, db: 1.0 }).is_empty());
    }

    #[test]
    fn every_param_round_trips_through_the_desk_format() {
        let params = vec![
            ChannelParam::Fader { level: 0.75 },
            ChannelParam::Mute { muted: true },
            ChannelParam::Pan { pan: -0.5 },
            ChannelParam::Name { name: "Pastor".into() },
            ChannelParam::HpfOn { on: true },
            ChannelParam::HpfFreq { hz: 80.0 },
            ChannelParam::EqOn { on: false },
            ChannelParam::EqType { band: 3, kind: EqType::Veq },
            ChannelParam::EqFreq { band: 3, hz: 2500.0 },
            ChannelParam::EqGain { band: 4, db: -3.5 },
            ChannelParam::EqQ { band: 2, q: 1.4 },
            ChannelParam::GateOn { on: true },
            ChannelParam::GateThreshold { db: -45.0 },
            ChannelParam::GateRange { db: 30.0 },
            ChannelParam::GateAttack { ms: 2.0 },
            ChannelParam::GateHold { ms: 50.0 },
            ChannelParam::GateRelease { ms: 200.0 },
            ChannelParam::CompOn { on: true },
            ChannelParam::CompThreshold { db: -18.0 },
            ChannelParam::CompRatio { ratio: 3.0 },
            ChannelParam::CompKnee { db: 2.0 },
            ChannelParam::CompMakeup { db: 6.0 },
            ChannelParam::CompAttack { ms: 10.0 },
            ChannelParam::CompHold { ms: 1.0 },
            ChannelParam::CompRelease { ms: 150.0 },
        ];
        for p in params {
            let pk = osc_set(9, &p);
            let (addr, args) = decode(&pk[0]).unwrap();
            let back = osc_decode(&addr, &args).unwrap_or_else(|| panic!("no decode for {addr}"));
            assert_eq!(back.channel, 9);
            let ok = match (&p, &back.param) {
                (ChannelParam::HpfFreq { hz: a }, ChannelParam::HpfFreq { hz: b })
                | (ChannelParam::EqFreq { hz: a, .. }, ChannelParam::EqFreq { hz: b, .. }) => close(*a, *b, a * 0.001),
                (ChannelParam::EqQ { q: a, .. }, ChannelParam::EqQ { q: b, .. }) => close(*a, *b, 0.01),
                (ChannelParam::GateHold { ms: a }, ChannelParam::GateHold { ms: b })
                | (ChannelParam::GateRelease { ms: a }, ChannelParam::GateRelease { ms: b })
                | (ChannelParam::CompHold { ms: a }, ChannelParam::CompHold { ms: b })
                | (ChannelParam::CompRelease { ms: a }, ChannelParam::CompRelease { ms: b }) => close(*a, *b, a * 0.001),
                (a, b) => match (a, b) {
                    (ChannelParam::Pan { pan: x }, ChannelParam::Pan { pan: y }) => close(*x, *y, 1e-5),
                    (ChannelParam::EqGain { db: x, .. }, ChannelParam::EqGain { db: y, .. })
                    | (ChannelParam::GateThreshold { db: x }, ChannelParam::GateThreshold { db: y })
                    | (ChannelParam::GateRange { db: x }, ChannelParam::GateRange { db: y })
                    | (ChannelParam::CompThreshold { db: x }, ChannelParam::CompThreshold { db: y })
                    | (ChannelParam::CompKnee { db: x }, ChannelParam::CompKnee { db: y })
                    | (ChannelParam::CompMakeup { db: x }, ChannelParam::CompMakeup { db: y })
                    | (ChannelParam::GateAttack { ms: x }, ChannelParam::GateAttack { ms: y })
                    | (ChannelParam::CompAttack { ms: x }, ChannelParam::CompAttack { ms: y }) => close(*x, *y, 1e-3),
                    _ => a == b,
                },
            };
            assert!(ok, "{p:?} came back as {:?}", back.param);
        }
    }

    #[test]
    fn query_covers_every_setting() {
        let q = osc_query(3);
        assert_eq!(q.len(), query_suffixes().len());
        let (a, args) = decode(&q[0]).unwrap();
        assert_eq!(a, "/ch/03/mix/fader");
        assert!(args.is_empty());
        // Every queried address must be decodable when the desk answers it.
        for s in query_suffixes() {
            let arg = if s == "config/name" { OscArg::Str("x".into()) } else { OscArg::Float(0.5) };
            assert!(osc_decode(&format!("/ch/03/{s}"), &[arg]).is_some(), "{s}");
        }
    }

    #[test]
    fn fader_law() {
        assert_eq!(fader_to_db(0.0), None);
        assert_eq!(fader_to_db(0.75), Some(0.0));
        assert_eq!(fader_to_db(1.0), Some(10.0));
        assert_eq!(fader_to_db(0.5), Some(-10.0));
    }
}
