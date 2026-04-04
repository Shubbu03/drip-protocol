use anchor_lang::prelude::*;

use crate::{
    constants::{STREAM_STATE_SEED, STREAM_VAULT_SEED},
    error::DripError,
    state::{StreamState, StreamStatus, StreamVault},
    utils::current_unix_timestamp,
};

#[derive(Accounts)]
pub struct TickStream<'info> {
    pub crank: Signer<'info>,
    #[account(
        seeds = [STREAM_VAULT_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_vault.bump,
        constraint = stream_vault.status == StreamStatus::Active @ DripError::StreamClosed
    )]
    pub stream_vault: Account<'info, StreamVault>,
    #[account(
        mut,
        seeds = [STREAM_STATE_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_state.bump,
        constraint = stream_state.stream_id == stream_vault.stream_id @ DripError::StreamAccountMismatch
    )]
    pub stream_state: Account<'info, StreamState>,
}

impl<'info> TickStream<'info> {
    pub fn apply(&mut self) -> Result<()> {
        let now = current_unix_timestamp()?;
        let state = &mut self.stream_state;
        let vault = &self.stream_vault;

        let elapsed_secs = now.saturating_sub(state.last_tick).max(0) as u64;
        if elapsed_secs == 0 {
            return Ok(());
        }

        let earned = elapsed_secs
            .checked_mul(vault.rate_lamports_per_sec)
            .ok_or(DripError::MathOverflow)?;
        let remaining_budget = vault
            .deposited
            .checked_sub(state.streamed_so_far)
            .ok_or(DripError::AccountingInvariantViolated)?;
        let actual_earned = earned.min(remaining_budget);

        state.streamed_so_far = state
            .streamed_so_far
            .checked_add(actual_earned)
            .ok_or(DripError::MathOverflow)?;
        state.receiver_claimable = state
            .streamed_so_far
            .checked_sub(vault.claimed)
            .ok_or(DripError::AccountingInvariantViolated)?;
        state.last_tick = now;

        Ok(())
    }
}
