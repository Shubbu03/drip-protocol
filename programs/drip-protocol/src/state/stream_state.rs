use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StreamState {
    pub stream_id: u64,
    pub streamed_so_far: u64,
    pub receiver_claimable: u64,
    pub last_tick: i64,
    pub bump: u8,
}
