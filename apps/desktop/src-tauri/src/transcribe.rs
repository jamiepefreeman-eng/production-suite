//! Speech-to-text for Lyric Follow, on this computer (no internet needed).
//!
//! Uses whisper.cpp through the `whisper-rs` crate, with Metal on macOS.
//! Model files (ggml-*.bin) are downloaded from inside the app.
//! If whisper-rs changes its API, this is the only file to fix.

/// Created and used on the follow thread only, so it needn't be Send.
pub trait Transcriber {
    /// 16 kHz mono f32 samples -> text. `prompt` biases toward expected lyrics.
    fn transcribe(&mut self, samples: &[f32], prompt: Option<&str>) -> Result<String, String>;
}

#[cfg(feature = "lyric-follow")]
mod imp {
    use super::Transcriber;
    use std::path::Path;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

    pub struct Whisper {
        // Keep the context alive alongside its state.
        _ctx: WhisperContext,
        state: WhisperState,
        threads: i32,
    }

    pub fn load(path: &Path) -> Result<Box<dyn Transcriber>, String> {
        let p = path.to_str().ok_or("model path isn't valid text")?;
        let ctx = WhisperContext::new_with_params(p, WhisperContextParameters::default())
            .map_err(|e| format!("Couldn't load speech model {p}: {e}"))?;
        let state = ctx.create_state().map_err(|e| e.to_string())?;
        let threads = std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4);
        Ok(Box::new(Whisper { _ctx: ctx, state, threads }))
    }

    impl Transcriber for Whisper {
        fn transcribe(&mut self, samples: &[f32], prompt: Option<&str>) -> Result<String, String> {
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(self.threads);
            params.set_language(Some("en"));
            params.set_translate(false);
            params.set_no_context(true);
            params.set_single_segment(true);
            params.set_suppress_blank(true);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            if let Some(p) = prompt.filter(|p| !p.is_empty()) {
                params.set_initial_prompt(p);
            }
            self.state.full(params, samples).map_err(|e| e.to_string())?;
            let n = self.state.full_n_segments().map_err(|e| e.to_string())?;
            let mut text = String::new();
            for i in 0..n {
                text.push_str(&self.state.full_get_segment_text(i).map_err(|e| e.to_string())?);
                text.push(' ');
            }
            Ok(text)
        }
    }
}

#[cfg(feature = "lyric-follow")]
pub use imp::load;

#[cfg(not(feature = "lyric-follow"))]
pub fn load(_: &std::path::Path) -> Result<Box<dyn Transcriber>, String> {
    Err("This build doesn't include Lyric Follow (the lyric-follow feature is off)".into())
}
