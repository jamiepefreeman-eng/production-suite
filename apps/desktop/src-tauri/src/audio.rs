//! Audio device discovery — every USB/Thunderbolt/built-in interface the OS sees.
//! Uses cpal: CoreAudio on macOS, WASAPI on Windows (ASIO can be enabled with
//! cpal's `asio` feature + the Steinberg SDK).
//!
//! Next steps (see CLAUDE.md): playback engine for walk-in music, tracks and
//! click on chosen device outputs.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct AudioDevice {
    pub host: String,
    pub name: String,
    pub input_channels: u16,
    pub output_channels: u16,
    pub sample_rate: Option<u32>,
    pub is_default_input: bool,
    pub is_default_output: bool,
    /// Mixers that are also USB interfaces (X32/M32 X-USB, XR18, SQ, Avantis
    /// option cards) — handy for pairing a device with a mixer profile.
    pub matches_mixer: Option<String>,
}

fn mixer_hint(name: &str) -> Option<String> {
    let n = name.to_lowercase();
    let hits = [
        ("x-usb", "X32/M32"),
        ("x32", "X32/M32"),
        ("m32", "X32/M32"),
        ("dn32", "X32/M32"),
        ("xr18", "X Air"),
        ("x18", "X Air"),
        ("xr16", "X Air"),
        ("xr12", "X Air"),
        ("sq-", "Allen & Heath SQ"),
        ("sq ", "Allen & Heath SQ"),
        ("avantis", "Allen & Heath Avantis"),
        ("allen", "Allen & Heath"),
    ];
    hits.iter().find(|(k, _)| n.contains(k)).map(|(_, v)| v.to_string())
}

#[cfg(feature = "audio")]
fn enumerate() -> Result<Vec<AudioDevice>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let mut out = Vec::new();
    for host_id in cpal::available_hosts() {
        let Ok(host) = cpal::host_from_id(host_id) else { continue };
        let def_in = host.default_input_device().and_then(|d| d.name().ok());
        let def_out = host.default_output_device().and_then(|d| d.name().ok());
        let Ok(devices) = host.devices() else { continue };
        for d in devices {
            let Ok(name) = d.name() else { continue };
            let inp = d.default_input_config().ok();
            let outp = d.default_output_config().ok();
            out.push(AudioDevice {
                host: host_id.name().to_string(),
                input_channels: inp.as_ref().map(|c| c.channels()).unwrap_or(0),
                output_channels: outp.as_ref().map(|c| c.channels()).unwrap_or(0),
                sample_rate: outp.as_ref().or(inp.as_ref()).map(|c| c.sample_rate().0),
                is_default_input: def_in.as_deref() == Some(name.as_str()),
                is_default_output: def_out.as_deref() == Some(name.as_str()),
                matches_mixer: mixer_hint(&name),
                name,
            });
        }
    }
    Ok(out)
}

#[cfg(not(feature = "audio"))]
fn enumerate() -> Result<Vec<AudioDevice>, String> {
    Err("built without the audio feature".into())
}

#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    enumerate()
}
