//! Lyric Follow — listens to the singer and advances to the **next** slide.
//!
//! It never decides *which* slide to show; it only decides *when* to press
//! "next". The follower tracks how far the singer has got through the live
//! slide, and fires when they reach the advance point:
//!
//! ```text
//! words_early = 3
//! "I once was lost but now am found was blind but [now I see]"
//!                                             ^ advance here (3 words left)
//! ```
//!
//! Context it matches against:
//!   [tail of previous slide] [live slide] [next slide]
//! * Previous tail: after an early advance the singer is still finishing the
//!   last slide — those words are recognised and ignored instead of being
//!   mistaken for the new slide.
//! * Next slide: if the advance point was missed (cough, mis-hearing) and the
//!   singer is already on the next slide's words, it advances anyway.
//!
//! Input is words from a speech-to-text engine (Whisper in the desktop app),
//! fed as an overlapping rolling window; the follower aligns the latest words
//! with fuzzy matching so mis-heard words ("amazin grays") still count.

/// What the follower is allowed to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum FollowMode {
    /// Not listening.
    #[default]
    Off,
    /// Highlights "next" when it would advance; the operator presses it.
    Assist,
    /// Advances on its own. Any manual slide change pauses it briefly.
    Auto,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct FollowSettings {
    pub mode: FollowMode,
    /// Advance when this many words of the live slide are left to sing.
    /// 0 = on the last word.
    pub words_early: u32,
    /// 0..1 — how sure the match must be before acting.
    pub min_confidence: f32,
    /// Never advance sooner than this after a slide goes live.
    pub min_slide_ms: u32,
    /// After the operator changes slides by hand, wait this long before
    /// auto-advancing again.
    pub manual_hold_ms: u32,
    /// Give the speech engine the upcoming lyrics as a hint (more accurate).
    pub bias_prompt: bool,
}

impl Default for FollowSettings {
    fn default() -> Self {
        Self {
            mode: FollowMode::Off,
            words_early: 3,
            min_confidence: 0.6,
            min_slide_ms: 1500,
            manual_hold_ms: 4000,
            bias_prompt: true,
        }
    }
}

/// How many of the most recent heard words are aligned each update.
const HEARD_WINDOW: usize = 10;
/// Words of the previous slide kept as context.
const PREV_TAIL: usize = 8;
/// Fewest matching words before anything moves.
const MIN_MATCHED: usize = 3;
const GAP_HEARD: f32 = 0.7; // transcriber added a word
const GAP_LYRIC: f32 = 0.5; // transcriber dropped a word
const LAST_ROW_SLACK: usize = 2; // newest heard words may be cut off mid-word

/// Lower-case, letters and digits only. A token with none is not a word.
/// The UI uses the same rule (any letter/digit) to number words on screen.
pub fn normalize_word(w: &str) -> String {
    w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

pub fn tokenize(text: &str) -> Vec<String> {
    text.split_whitespace().map(normalize_word).filter(|w| !w.is_empty()).collect()
}

/// Remove speech-engine annotations: "[Music]", "(singing)", "♪", "*applause*".
pub fn strip_annotations(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0i32;
    let mut star = false;
    for c in text.chars() {
        match c {
            '[' | '(' | '{' => depth += 1,
            ']' | ')' | '}' => depth = (depth - 1).max(0),
            '*' => star = !star,
            '♪' | '♫' | '♬' => out.push(' '),
            _ if depth == 0 && !star => out.push(c),
            _ => {}
        }
    }
    out
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// 0..1 similarity between two normalized words.
pub fn similarity(a: &str, b: &str) -> f32 {
    if a == b {
        return 1.0;
    }
    let (ac, bc): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if ac.len() <= 2 || bc.len() <= 2 {
        return 0.0; // "a" vs "i" — short words must match exactly
    }
    1.0 - levenshtein(&ac, &bc) as f32 / ac.len().max(bc.len()) as f32
}

/// +1 exact, 0 at 50 % similar, down to -1.
fn word_score(a: &str, b: &str) -> f32 {
    ((similarity(a, b) - 0.5) * 2.0).max(-1.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncKind {
    /// The operator changed slides: start at the top, pause auto briefly.
    Manual,
    /// Lyric Follow (or "Take") advanced: keep listening through the tail of
    /// the previous slide.
    Auto,
}

/// One slide's identity and text, as the follower sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct SlideRef<'a> {
    pub presentation: u32,
    pub slide: u32,
    pub text: &'a str,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Advance {
    pub presentation: u32,
    pub slide: u32,
    /// False when a guard (min time on slide, manual hold) is holding it back.
    pub allowed: bool,
    pub blocked: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FollowUpdate {
    pub confidence: f32,
    pub matched: usize,
    /// Index (among the live slide's words) of the last word sung, if the
    /// singer is inside the live slide.
    pub sung_word: Option<usize>,
    /// Index of the word at which it advances.
    pub trigger_word: Option<usize>,
    /// Singer is still finishing the previous slide.
    pub in_previous: bool,
    pub advance: Option<Advance>,
}

#[derive(Debug, Clone)]
struct Align {
    end: usize, // exclusive index into ctx
    score: f32,
    matched: usize,
    conf: f32,
}

pub struct LyricFollower {
    settings: FollowSettings,
    ctx: Vec<String>,     // normalized: prev tail ++ live ++ next
    raw: Vec<String>,     // same, original spelling (for the speech-engine hint)
    prev_len: usize,
    live_len: usize,
    live: Option<(u32, u32)>,
    next: Option<(u32, u32)>,
    cursor: usize, // ctx index of the next word expected
    live_since_ms: u64,
    hold_until_ms: u64,
}

fn raw_words(text: &str) -> Vec<String> {
    text.split_whitespace().filter(|w| !normalize_word(w).is_empty()).map(|w| w.to_string()).collect()
}

impl LyricFollower {
    pub fn new(settings: FollowSettings) -> Self {
        Self {
            settings,
            ctx: vec![],
            raw: vec![],
            prev_len: 0,
            live_len: 0,
            live: None,
            next: None,
            cursor: 0,
            live_since_ms: 0,
            hold_until_ms: 0,
        }
    }

    pub fn settings(&self) -> &FollowSettings {
        &self.settings
    }

    pub fn set_settings(&mut self, s: FollowSettings) {
        self.settings = s;
    }

    pub fn live(&self) -> Option<(u32, u32)> {
        self.live
    }

    pub fn next(&self) -> Option<(u32, u32)> {
        self.next
    }

    /// Call whenever a slide goes live.
    pub fn set_slides(&mut self, prev: Option<SlideRef>, live: SlideRef, next: Option<SlideRef>, now_ms: u64, kind: SyncKind) {
        // After an auto advance, if the singer was still in the old slide's
        // tail, keep tracking it; otherwise start at the top of the slide.
        let mut raw_prev = prev.map(|p| raw_words(p.text)).unwrap_or_default();
        let keep_from = raw_prev.len().saturating_sub(PREV_TAIL);
        raw_prev.drain(..keep_from);
        let still_in_prev = match kind {
            SyncKind::Auto => {
                // Words of the old live slide not yet sung when we advanced.
                let old_live_end = self.prev_len + self.live_len;
                if self.live.is_some() && self.cursor < old_live_end && self.cursor >= self.prev_len {
                    Some(old_live_end - self.cursor)
                } else {
                    None
                }
            }
            SyncKind::Manual => None,
        };

        let raw_live = raw_words(live.text);
        let raw_next = next.as_ref().map(|n| raw_words(n.text)).unwrap_or_default();
        self.prev_len = raw_prev.len();
        self.live_len = raw_live.len();
        self.raw = raw_prev.into_iter().chain(raw_live).chain(raw_next).collect();
        self.ctx = self.raw.iter().map(|w| normalize_word(w)).collect();
        self.live = Some((live.presentation, live.slide));
        self.next = next.map(|n| (n.presentation, n.slide));
        self.live_since_ms = now_ms;
        self.cursor = match still_in_prev {
            Some(left) => self.prev_len.saturating_sub(left.min(self.prev_len)),
            None => self.prev_len,
        };
        if kind == SyncKind::Manual {
            self.hold_until_ms = now_ms + self.settings.manual_hold_ms as u64;
        }
    }

    pub fn clear(&mut self) {
        self.live = None;
        self.next = None;
        self.ctx.clear();
        self.raw.clear();
        self.prev_len = 0;
        self.live_len = 0;
        self.cursor = 0;
    }

    /// Word index (in the live slide) where the advance fires.
    pub fn trigger_word(&self) -> Option<usize> {
        trigger_index(self.live_len, self.settings.words_early)
    }

    /// Upcoming lyrics, to bias the speech engine toward the right words.
    pub fn prompt_text(&self, max_words: usize) -> String {
        let start = self.cursor.saturating_sub(4);
        self.raw.iter().skip(start).take(max_words).cloned().collect::<Vec<_>>().join(" ")
    }

    /// Feed the latest transcript words (normalized, oldest first).
    pub fn hear(&mut self, heard: &[String], now_ms: u64) -> FollowUpdate {
        let mut up = FollowUpdate { trigger_word: self.trigger_word(), ..Default::default() };
        let Some((pres, _)) = self.live else { return up };
        let h = &heard[heard.len().saturating_sub(HEARD_WINDOW)..];
        if h.len() >= MIN_MATCHED && !self.ctx.is_empty() {
            if let Some(a) = self.align(h) {
                up.confidence = a.conf;
                up.matched = a.matched;
                if a.conf >= self.settings.min_confidence && a.end > self.cursor {
                    self.cursor = a.end; // only ever forward
                }
            }
        }

        let live_end = self.prev_len + self.live_len;
        if self.cursor > 0 {
            let s = self.cursor - 1;
            if s < self.prev_len {
                up.in_previous = true;
            } else if s < live_end {
                up.sung_word = Some(s - self.prev_len);
            } else {
                up.sung_word = self.live_len.checked_sub(1);
            }
        }

        let Some((np, ns)) = self.next else { return up };
        let reason = if self.cursor > live_end {
            Some("already singing the next slide".to_string())
        } else {
            match (up.sung_word, up.trigger_word) {
                (Some(w), Some(t)) if w >= t && self.cursor > self.prev_len => Some(if self.settings.words_early == 0 {
                    "last word sung".to_string()
                } else {
                    format!("{} word(s) before the end", self.settings.words_early)
                }),
                _ => None,
            }
        };
        if let Some(reason) = reason {
            let blocked = if now_ms < self.hold_until_ms {
                Some("paused after a manual slide change".to_string())
            } else if now_ms < self.live_since_ms + self.settings.min_slide_ms as u64 {
                Some("slide hasn't been up long enough".to_string())
            } else {
                None
            };
            let _ = pres;
            up.advance = Some(Advance { presentation: np, slide: ns, allowed: blocked.is_none(), blocked, reason });
        }
        up
    }

    /// Local alignment (Smith-Waterman) of the newest heard words against the
    /// context, ending at (or within LAST_ROW_SLACK of) the newest word.
    fn align(&self, h: &[String]) -> Option<Align> {
        #[derive(Clone, Copy, Default)]
        struct Cell {
            score: f32,
            matched: u16,
            start: u16,
        }
        let (m, n) = (h.len(), self.ctx.len());
        let mut prev = vec![Cell::default(); n + 1];
        let mut cur = vec![Cell::default(); n + 1];
        let mut cands: Vec<Align> = Vec::new();
        for i in 1..=m {
            cur[0] = Cell { score: 0.0, matched: 0, start: i as u16 };
            for j in 1..=n {
                let s = word_score(&h[i - 1], &self.ctx[j - 1]);
                let p = prev[j - 1];
                let diag = Cell {
                    score: p.score + s,
                    matched: p.matched + u16::from(s > 0.0),
                    start: if p.score <= 0.0 { (i - 1) as u16 } else { p.start },
                };
                let up = Cell { score: prev[j].score - GAP_HEARD, ..prev[j] };
                let left = Cell { score: cur[j - 1].score - GAP_LYRIC, ..cur[j - 1] };
                let mut best = Cell { score: 0.0, matched: 0, start: i as u16 };
                for c in [diag, up, left] {
                    if c.score > best.score {
                        best = c;
                    }
                }
                cur[j] = best;
                if i + LAST_ROW_SLACK >= m && best.matched as usize >= MIN_MATCHED {
                    let adjusted = best.score - 0.5 * (m - i) as f32;
                    let span = i - best.start as usize;
                    let conf = (adjusted / span.max(4) as f32).clamp(0.0, 1.0);
                    cands.push(Align { end: j, score: adjusted, matched: best.matched as usize, conf });
                }
            }
            std::mem::swap(&mut prev, &mut cur);
        }
        let max = cands.iter().map(|c| c.score).fold(f32::MIN, f32::max);
        // Ties (repeated phrases): prefer the nearest place at/after the cursor.
        let dist = |e: usize| if e >= self.cursor { e - self.cursor } else { 1000 + self.cursor - e };
        cands.into_iter().filter(|c| c.score >= max - 0.3).min_by_key(|c| dist(c.end))
    }
}

/// Advance point for a slide with `len` words, `early` words before the end.
pub fn trigger_index(len: usize, early: u32) -> Option<usize> {
    if len == 0 {
        None
    } else {
        Some(len.saturating_sub(1).saturating_sub(early as usize))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "Amazing grace how sweet the sound\nThat saved a wretch like me";
    const B: &str = "I once was lost but now am found\nWas blind but now I see";
    const C: &str = "Twas grace that taught my heart to fear\nAnd grace my fears relieved";

    fn s(slide: u32, text: &str) -> SlideRef<'_> {
        SlideRef { presentation: 1, slide, text }
    }
    fn words(t: &str) -> Vec<String> {
        tokenize(t)
    }
    fn settings(early: u32) -> FollowSettings {
        FollowSettings { words_early: early, min_slide_ms: 0, manual_hold_ms: 0, ..Default::default() }
    }
    /// Feed the slide word by word as a growing transcript; return the word
    /// count at which an advance first appeared.
    fn feed_until_advance(f: &mut LyricFollower, text: &str, now: u64) -> Option<usize> {
        let w = words(text);
        for k in 1..=w.len() {
            if f.hear(&w[..k], now).advance.is_some() {
                return Some(k);
            }
        }
        None
    }

    #[test]
    fn three_words_early() {
        let mut f = LyricFollower::new(settings(3));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        // 12 words; 3 early -> fires once word 9 ("a") is heard.
        assert_eq!(f.trigger_word(), Some(8));
        assert_eq!(feed_until_advance(&mut f, A, 10_000), Some(9));
    }

    #[test]
    fn zero_early_waits_for_last_word() {
        let mut f = LyricFollower::new(settings(0));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        assert_eq!(feed_until_advance(&mut f, A, 10_000), Some(12));
    }

    #[test]
    fn misheard_words_still_count() {
        let mut f = LyricFollower::new(settings(3));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        let up = f.hear(&words("amazin grays how sweet the sound that saved a"), 10_000);
        assert!(up.advance.is_some(), "{up:?}");
        assert_eq!(up.advance.unwrap().slide, 2);
    }

    #[test]
    fn unrelated_words_do_nothing() {
        let mut f = LyricFollower::new(settings(3));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        let up = f.hear(&words("thank you so much for watching please subscribe"), 10_000);
        assert!(up.advance.is_none());
        assert_eq!(up.sung_word, None);
    }

    #[test]
    fn catches_up_if_already_on_next_slide() {
        let mut f = LyricFollower::new(settings(0));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        let up = f.hear(&words("i once was lost but now"), 10_000);
        assert_eq!(up.advance.unwrap().reason, "already singing the next slide");
    }

    #[test]
    fn tail_of_previous_slide_is_ignored_after_early_advance() {
        let mut f = LyricFollower::new(settings(3));
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        let w = words(A);
        assert!(f.hear(&w[..9], 10_000).advance.is_some());
        // App advances; singer finishes "wretch like me".
        f.set_slides(Some(s(1, A)), s(2, B), Some(s(3, C)), 10_000, SyncKind::Auto);
        let up = f.hear(&w[..12], 11_000);
        assert!(up.in_previous, "{up:?}");
        assert!(up.advance.is_none());
        // Then sings slide 2 and it advances 3 words early again.
        let mut all = w.clone();
        all.extend(words(B));
        let mut fired = None;
        for k in 13..=all.len() {
            if f.hear(&all[..k], 12_000).advance.is_some() {
                fired = Some(k - 12);
                break;
            }
        }
        assert_eq!(fired, Some(14 - 3)); // slide 2 has 14 words
    }

    #[test]
    fn guards_hold_it_back() {
        let mut f = LyricFollower::new(FollowSettings { words_early: 3, min_slide_ms: 3000, manual_hold_ms: 5000, ..Default::default() });
        f.set_slides(None, s(1, A), Some(s(2, B)), 0, SyncKind::Manual);
        let a = f.hear(&words(A), 1000).advance.unwrap();
        assert!(!a.allowed);
        assert_eq!(a.blocked.as_deref(), Some("paused after a manual slide change"));
        assert!(f.hear(&words(A), 6000).advance.unwrap().allowed);
    }

    #[test]
    fn last_slide_has_nothing_to_advance_to() {
        let mut f = LyricFollower::new(settings(3));
        f.set_slides(None, s(1, A), None, 0, SyncKind::Manual);
        assert!(f.hear(&words(A), 10_000).advance.is_none());
    }

    #[test]
    fn annotations_and_tokens() {
        assert_eq!(tokenize(&strip_annotations("[Music] ♪ 'Twas grace (singing) that—")), vec!["twas", "grace", "that"]);
        assert_eq!(trigger_index(2, 5), Some(0));
        assert_eq!(trigger_index(0, 3), None);
    }
}
