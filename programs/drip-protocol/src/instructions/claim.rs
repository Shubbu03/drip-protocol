use anchor_lang::prelude::*;

use crate::{
    constants::{STREAM_STATE_SEED, STREAM_VAULT_SEED},
    error::DripError,
    events::StreamClaimed,
    state::{StreamState, StreamStatus, StreamVault},
    utils::{deserialize_account, transfer_lamports},
};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub receiver_authority: Signer<'info>,
    /// CHECK: The receiver account is validated against the vault and credited with lamports.
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [STREAM_VAULT_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_vault.bump,
        has_one = receiver,
        constraint = stream_vault.status == StreamStatus::Active @ DripError::StreamClosed
    )]
    pub stream_vault: Account<'info, StreamVault>,
    #[account(
        seeds = [STREAM_STATE_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump
    )]
    /// CHECK: The stream state may remain delegated during mid-stream claims. Its committed bytes are deserialized manually.
    pub stream_state: AccountInfo<'info>,
}

impl<'info> Claim<'info> {
    pub fn validate(&self) -> Result<()> {
        require_keys_eq!(
            self.receiver_authority.key(),
            self.receiver.key(),
            DripError::Unauthorized
        );
        Ok(())
    }

    pub fn apply(&mut self) -> Result<()> {
        self.validate()?;

        let stream_state = deserialize_account::<StreamState>(&self.stream_state)?;
        require!(
            stream_state.stream_id == self.stream_vault.stream_id,
            DripError::StreamAccountMismatch
        );
        require!(
            stream_state.streamed_so_far >= self.stream_vault.claimed,
            DripError::AccountingInvariantViolated
        );

        let amount = stream_state
            .streamed_so_far
            .checked_sub(self.stream_vault.claimed)
            .ok_or(DripError::AccountingInvariantViolated)?;
        require!(amount > 0, DripError::NothingToClaim);

        transfer_lamports(
            &self.stream_vault.to_account_info(),
            &self.receiver.to_account_info(),
            amount,
        )?;

        self.stream_vault.claimed = self
            .stream_vault
            .claimed
            .checked_add(amount)
            .ok_or(DripError::MathOverflow)?;

        emit!(StreamClaimed {
            stream_id: self.stream_vault.stream_id,
            receiver: self.receiver.key(),
            amount,
            total_claimed: self.stream_vault.claimed,
        });

        Ok(())
    }
}
