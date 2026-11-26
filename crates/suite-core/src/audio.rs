//! Small audio helpers for Lyric Follow (std only).

/// Streaming linear resampler with a one-pole low-pass in front, e.g.
/// 48 kHz interface audio -> 16 kHz for speech recognition.
pub struct Resampler {
    step: f64,
    t: f64,
    prev: f32,
    lp: f32,
    alpha: f32,
}

impl Resampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        let fc = (output_rate as f32 * 0.45).min(input_rate as f32 * 0.45);
        let alpha = 1.0 - (-2.0 * std::f32::consts::PI * fc / input_rate as f32).exp();
        Self { step: input_rate as f64 / output_rate as f64, t: 0.0, prev: 0.0, lp: 0.0, alpha }
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        for &x in input {
            self.lp += self.alpha * (x - self.lp);
            let x = self.lp;
            while self.t < 1.0 {
                out.push(self.prev + (x - self.prev) * self.t as f32);
                self.t += self.step;
            }
            self.t -= 1.0;
            self.prev = x;
        }
    }
}

/// RMS level in dBFS (-inf clamps to -120).
pub fn rms_dbfs(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return -120.0;
    }
    let ms = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    (10.0 * ms.max(1e-12).log10()).max(-120.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_48k_to_16k() {
        let input: Vec<f32> = (0..48_000).map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0).sin() * 0.5).collect();
        let mut r = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        r.process(&input[..20_000], &mut out);
        r.process(&input[20_000..], &mut out);
        assert!((out.len() as i32 - 16_000).abs() <= 2, "{}", out.len());
        let peak = out[1000..].iter().fold(0f32, |a, b| a.max(b.abs()));
        assert!(peak > 0.4 && peak < 0.55, "{peak}");
    }

    #[test]
    fn levels() {
        assert!((rms_dbfs(&[1.0, -1.0]) - 0.0).abs() < 0.01);
        assert!((rms_dbfs(&[0.1; 100]) + 20.0).abs() < 0.01);
        assert_eq!(rms_dbfs(&[]), -120.0);
    }
}
