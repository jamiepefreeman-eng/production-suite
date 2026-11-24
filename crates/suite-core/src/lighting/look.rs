//! Looks (what each fixture should be doing) and cues (stored looks + timing).

use super::Rgb;
use std::collections::BTreeMap;

/// Per-fixture state. `None` means "this look doesn't control it".
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FixtureState {
    /// 0..1
    pub intensity: Option<f32>,
    pub color: Option<Rgb>,
    /// 0 = open, 1.. = gobo slot
    pub gobo: Option<u8>,
    /// 0..1 normalised
    pub pan: Option<f32>,
    pub tilt: Option<f32>,
}

impl FixtureState {
    /// Layer `top` over `self`; anything `top` sets wins.
    pub fn merged(&self, top: &FixtureState) -> FixtureState {
        FixtureState {
            intensity: top.intensity.or(self.intensity),
            color: top.color.or(self.color),
            gobo: top.gobo.or(self.gobo),
            pan: top.pan.or(self.pan),
            tilt: top.tilt.or(self.tilt),
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == FixtureState::default()
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Look {
    /// JSON writes these keys as strings ("7"); see `u32_keys` for reading them back.
    #[cfg_attr(feature = "serde", serde(deserialize_with = "u32_keys::deserialize"))]
    pub fixtures: BTreeMap<u32, FixtureState>,
}

/// Reads a map whose keys are fixture ids, accepting `"7"` as well as `7`.
/// Tauri hands command arguments over as a borrowed `serde_json::Value`, and on
/// that path serde_json does not convert string keys to numbers by itself.
#[cfg(feature = "serde")]
mod u32_keys {
    use serde::de::{Deserializer, Error, MapAccess, Visitor};
    use std::collections::BTreeMap;
    use std::fmt;
    use std::marker::PhantomData;

    struct Key(u32);

    impl<'de> serde::Deserialize<'de> for Key {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct V;
            impl Visitor<'_> for V {
                type Value = Key;
                fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                    f.write_str("a fixture id (number or numeric string)")
                }
                fn visit_u64<E: Error>(self, v: u64) -> Result<Key, E> {
                    u32::try_from(v).map(Key).map_err(E::custom)
                }
                fn visit_i64<E: Error>(self, v: i64) -> Result<Key, E> {
                    u32::try_from(v).map(Key).map_err(E::custom)
                }
                fn visit_str<E: Error>(self, v: &str) -> Result<Key, E> {
                    v.trim().parse().map(Key).map_err(|_| E::custom(format!("bad fixture id {v:?}")))
                }
            }
            d.deserialize_any(V)
        }
    }

    pub fn deserialize<'de, D, T>(d: D) -> Result<BTreeMap<u32, T>, D::Error>
    where
        D: Deserializer<'de>,
        T: serde::Deserialize<'de>,
    {
        struct M<T>(PhantomData<T>);
        impl<'de, T: serde::Deserialize<'de>> Visitor<'de> for M<T> {
            type Value = BTreeMap<u32, T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a map of fixture id to state")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Self::Value, A::Error> {
                let mut out = BTreeMap::new();
                while let Some((Key(k), v)) = m.next_entry::<Key, T>()? {
                    out.insert(k, v);
                }
                Ok(out)
            }
        }
        d.deserialize_map(M(PhantomData))
    }
}

impl Look {
    pub fn state_mut(&mut self, fixture: u32) -> &mut FixtureState {
        self.fixtures.entry(fixture).or_default()
    }

    pub fn merged(&self, top: &Look) -> Look {
        let mut out = self.clone();
        for (id, st) in &top.fixtures {
            let base = out.fixtures.get(id).cloned().unwrap_or_default();
            out.fixtures.insert(*id, base.merged(st));
        }
        out
    }

    pub fn clear(&mut self) {
        self.fixtures.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.fixtures.values().all(|s| s.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Cue {
    pub id: u32,
    pub name: String,
    pub look: Look,
    pub fade_ms: u32,
    /// The sentence that built it, if the AI scene builder made it.
    pub source_text: Option<String>,
}
