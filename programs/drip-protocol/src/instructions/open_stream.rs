use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::{STREAM_STATE_SEED, STREAM_VAULT_SEED},
    error::DripError,
    events::StreamOpened,
    state::{StreamState, StreamStatus, StreamVault},
    utils::current_unix_timestamp,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct OpenStreamArgs {
    pub stream_id: u64,
    pub rate_lamports_per_sec: u64,
    pub deposit_lamports: u64,
}

#[derive(Accounts)]
#[instruction(args: OpenStreamArgs)]
pub struct OpenStream<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Receiver can be any valid Solana account that can accept lamports.
    pub receiver: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + StreamVault::INIT_SPACE,
        seeds = [STREAM_VAULT_SEED, &args.stream_id.to_le_bytes()],
        bump
    )]
    pub stream_vault: Account<'info, StreamVault>,
    #[account(
        init,
        payer = payer,
        space = 8 + StreamState::INIT_SPACE,
        seeds = [STREAM_STATE_SEED, &args.stream_id.to_le_bytes()],
        bump
    )]
    pub stream_state: Account<'info, StreamState>,
    pub system_program: Program<'info, System>,
}

impl<'info> OpenStream<'info> {
    pub fn validate(&self, args: &OpenStreamArgs) -> Result<()> {
        require!(args.stream_id > 0, DripError::InvalidStreamId);
        require!(args.rate_lamports_per_sec > 0, DripError::InvalidStreamRate);
        require!(args.deposit_lamports > 0, DripError::InvalidDepositAmount);
        Ok(())
    }

    pub fn apply(&mut self, args: OpenStreamArgs, bumps: &OpenStreamBumps) -> Result<()> {
        self.validate(&args)?;

        let now = current_unix_timestamp()?;
        let vault = &mut self.stream_vault;
        vault.stream_id = args.stream_id;
        vault.payer = self.payer.key();
        vault.receiver = self.receiver.key();
        vault.rate_lamports_per_sec = args.rate_lamports_per_sec;
        vault.deposited = args.deposit_lamports;
        vault.claimed = 0;
        vault.status = StreamStatus::Active;
        vault.created_at = now;
        vault.bump = bumps.stream_vault;

        let state = &mut self.stream_state;
        state.stream_id = args.stream_id;
        state.streamed_so_far = 0;
        state.receiver_claimable = 0;
        state.last_tick = now;
        state.bump = bumps.stream_state;

        transfer(
            CpiContext::new(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.payer.to_account_info(),
                    to: vault.to_account_info(),
                },
            ),
            args.deposit_lamports,
        )?;

        emit!(StreamOpened {
            stream_id: args.stream_id,
            payer: vault.payer,
            receiver: vault.receiver,
            rate_lamports_per_sec: vault.rate_lamports_per_sec,
            deposited: vault.deposited,
            created_at: vault.created_at,
        });

        Ok(())
    }
}
