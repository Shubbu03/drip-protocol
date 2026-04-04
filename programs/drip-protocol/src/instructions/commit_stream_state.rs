use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
    constants::{STREAM_STATE_SEED, STREAM_VAULT_SEED},
    state::StreamVault,
};

#[commit]
#[derive(Accounts)]
pub struct CommitStreamState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [STREAM_VAULT_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump = stream_vault.bump
    )]
    pub stream_vault: Account<'info, StreamVault>,
    #[account(
        mut,
        seeds = [STREAM_STATE_SEED, &stream_vault.stream_id.to_le_bytes()],
        bump
    )]
    /// CHECK: The delegated stream state is committed via the MagicBlock program and may not currently be owned by this program.
    pub stream_state: AccountInfo<'info>,
}

impl<'info> CommitStreamState<'info> {
    pub fn apply(&self) -> Result<()> {
        commit_accounts(
            &self.payer,
            vec![&self.stream_state.to_account_info()],
            &self.magic_context,
            &self.magic_program,
        )?;

        Ok(())
    }
}
