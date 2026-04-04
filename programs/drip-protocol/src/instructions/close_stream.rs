use anchor_lang::prelude::*;

use crate::{
    constants::{STREAM_STATE_SEED, STREAM_VAULT_SEED},
    error::DripError,
    events::StreamClosed,
    state::{StreamState, StreamStatus, StreamVault},
    utils::{calc_total_owed, current_unix_timestamp, transfer_lamports},
};

#[derive(Accounts)]
pub struct CloseStream<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Payer is validated against the vault and receives refunds plus account rent on close.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    /// CHECK: Receiver is validated against the vault and receives the final settlement.
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
    #[account(
        mut,
        close = payer,
        seeds = [STREAM_VAULT_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_vault.bump,
        has_one = payer,
        has_one = receiver,
        constraint = stream_vault.status == StreamStatus::Active @ DripError::StreamClosed
    )]
    pub stream_vault: Account<'info, StreamVault>,
    #[account(
        mut,
        close = payer,
        seeds = [STREAM_STATE_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_state.bump,
        constraint = stream_state.stream_id == stream_vault.stream_id @ DripError::StreamAccountMismatch
    )]
    pub stream_state: Account<'info, StreamState>,
}

impl<'info> CloseStream<'info> {
    pub fn validate(&self) -> Result<()> {
        let authority_key = self.authority.key();
        require!(
            authority_key == self.payer.key() || authority_key == self.receiver.key(),
            DripError::Unauthorized
        );
        Ok(())
    }

    pub fn apply(&mut self) -> Result<()> {
        self.validate()?;

        let now = current_unix_timestamp()?;
        let l1_total_owed = calc_total_owed(&self.stream_vault, now)?;
        let total_owed = l1_total_owed.max(self.stream_state.streamed_so_far);
        require!(
            total_owed >= self.stream_vault.claimed,
            DripError::AccountingInvariantViolated
        );

        let receiver_final = total_owed
            .checked_sub(self.stream_vault.claimed)
            .ok_or(DripError::AccountingInvariantViolated)?;
        let payer_refund = self
            .stream_vault
            .deposited
            .checked_sub(total_owed)
            .ok_or(DripError::AccountingInvariantViolated)?;

        transfer_lamports(
            &self.stream_vault.to_account_info(),
            &self.receiver.to_account_info(),
            receiver_final,
        )?;
        transfer_lamports(
            &self.stream_vault.to_account_info(),
            &self.payer.to_account_info(),
            payer_refund,
        )?;

        self.stream_vault.claimed = total_owed;
        self.stream_vault.status = StreamStatus::Closed;
        self.stream_state.streamed_so_far = total_owed;
        self.stream_state.receiver_claimable = 0;
        self.stream_state.last_tick = self.stream_state.last_tick.max(now);

        emit!(StreamClosed {
            stream_id: self.stream_vault.stream_id,
            payer: self.payer.key(),
            receiver: self.receiver.key(),
            total_streamed: total_owed,
            receiver_earned: total_owed,
            payer_refunded: payer_refund,
            closed_at: now,
        });

        Ok(())
    }
}
