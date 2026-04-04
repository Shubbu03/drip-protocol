use anchor_lang::prelude::*;

#[constant]
pub const STREAM_VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const STREAM_STATE_SEED: &[u8] = b"stream";

#[constant]
pub const DEFAULT_COMMIT_FREQUENCY_MS: u32 = 10_000;
