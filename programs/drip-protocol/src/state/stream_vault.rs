use anchor_lang::prelude::*;

use crate::state::StreamStatus;

#[account]
#[derive(InitSpace)]
pub struct StreamVault {
    pub stream_id: u64,
    pub payer: Pubkey,
    pub receiver: Pubkey,
    pub rate_lamports_per_sec: u64,
    pub deposited: u64,
    pub claimed: u64,
    pub status: StreamStatus,
    pub created_at: i64,
    pub bump: u8,
}
