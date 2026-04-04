#![allow(unexpected_cfgs, deprecated)]
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("2zpBm2o5Sxw1GXpH4eSvqVqVLUPphfpM2BxADg2g7B5c");

#[ephemeral]
#[program]
pub mod drip_protocol {
    use super::*;

    pub fn open_stream(ctx: Context<OpenStream>, args: OpenStreamArgs) -> Result<()> {
        ctx.accounts.apply(args, &ctx.bumps)
    }

    pub fn tick_stream(ctx: Context<TickStream>) -> Result<()> {
        ctx.accounts.apply()
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        ctx.accounts.apply()
    }

    pub fn close_stream(ctx: Context<CloseStream>) -> Result<()> {
        ctx.accounts.apply()
    }

    pub fn delegate_stream_state(
        ctx: Context<DelegateStreamState>,
        args: DelegateStreamStateArgs,
    ) -> Result<()> {
        ctx.accounts.apply(args)
    }

    pub fn commit_stream_state(ctx: Context<CommitStreamState>) -> Result<()> {
        ctx.accounts.apply()
    }

    pub fn undelegate_stream_state(ctx: Context<UndelegateStreamState>) -> Result<()> {
        ctx.accounts.apply()
    }
}
