use anchor_lang::prelude::*;

use crate::{error::DripError, state::StreamVault};

pub fn current_unix_timestamp() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

pub fn elapsed_secs(from: i64, to: i64) -> u64 {
    to.saturating_sub(from).max(0) as u64
}

pub fn calc_total_owed(vault: &StreamVault, now: i64) -> Result<u64> {
    let elapsed = elapsed_secs(vault.created_at, now);
    let uncapped = elapsed
        .checked_mul(vault.rate_lamports_per_sec)
        .ok_or(DripError::MathOverflow)?;

    Ok(uncapped.min(vault.deposited))
}

pub fn transfer_lamports(from: &AccountInfo<'_>, to: &AccountInfo<'_>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let from_balance = from.get_lamports();
    let to_balance = to.get_lamports();

    require!(from_balance >= amount, DripError::InsufficientVaultBalance);

    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(amount)
        .ok_or(DripError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to_balance
        .checked_add(amount)
        .ok_or(DripError::MathOverflow)?;

    Ok(())
}

pub fn deserialize_account<T: AccountDeserialize>(account: &AccountInfo<'_>) -> Result<T> {
    let data = account.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    T::try_deserialize(&mut data_slice)
}
