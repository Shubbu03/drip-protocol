use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
    constants::{DEFAULT_COMMIT_FREQUENCY_MS, STREAM_STATE_SEED, STREAM_VAULT_SEED},
    error::DripError,
    state::{StreamStatus, StreamVault},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct DelegateStreamStateArgs {
    pub validator: Option<Pubkey>,
    pub commit_frequency_ms: Option<u32>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateStreamState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [STREAM_VAULT_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_vault.bump,
        has_one = payer,
        constraint = stream_vault.status == StreamStatus::Active @ DripError::StreamClosed
    )]
    pub stream_vault: Account<'info, StreamVault>,
    /// CHECK: The delegated account is verified by the PDA seeds and delegation program.
    #[account(
        mut,
        seeds = [STREAM_STATE_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump,
        del
    )]
    pub stream_state: AccountInfo<'info>,
}

impl<'info> DelegateStreamState<'info> {
    pub fn apply(&self, args: DelegateStreamStateArgs) -> Result<()> {
        let stream_id_bytes = self.stream_vault.stream_id.to_le_bytes();

        self.delegate_stream_state(
            &self.payer,
            &[STREAM_STATE_SEED, stream_id_bytes.as_ref()],
            DelegateConfig {
                validator: args.validator,
                commit_frequency_ms: args
                    .commit_frequency_ms
                    .unwrap_or(DEFAULT_COMMIT_FREQUENCY_MS),
                ..Default::default()
            },
        )?;

        Ok(())
    }
}
