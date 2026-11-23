//! The AI scene builder.
//!
//! Plain language -> [`Intent`]s -> validated against the patch -> a [`Look`].
//!
//! Two front ends produce the same intents:
//! * [`parser`] — a built-in, offline parser for everyday phrases. Always
//!   available, no internet needed on a Sunday morning.
//! * [`prompt`] — builds the prompt for an LLM (Claude) for anything the
//!   offline parser can't handle. The desktop app sends it and deserialises
//!   the JSON reply into the same `Intent` type.
//!
//! The AI never writes raw DMX. [`resolve`] is deterministic and refuses
//! anything that doesn't exist in the patch.
//!
//! [`Look`]: crate::lighting::Look

pub mod intent;
pub mod parser;
pub mod prompt;
pub mod resolve;

pub use intent::{Action, Intent};
pub use parser::parse;
pub use resolve::{resolve, Resolution};
