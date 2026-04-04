use anchor_lang::prelude::*;

#[event]
pub struct StreamOpened {
    pub stream_id: u64,
    pub payer: Pubkey,
    pub receiver: Pubkey,
    pub rate_lamports_per_sec: u64,
    pub deposited: u64,
    pub created_at: i64,
}

#[event]
pub struct StreamClaimed {
    pub stream_id: u64,
    pub receiver: Pubkey,
    pub amount: u64,
    pub total_claimed: u64,
}

#[event]
pub struct StreamClosed {
    pub stream_id: u64,
    pub payer: Pubkey,
    pub receiver: Pubkey,
    pub total_streamed: u64,
    pub receiver_earned: u64,
    pub payer_refunded: u64,
    pub closed_at: i64,
}
