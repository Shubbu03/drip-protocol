use anchor_lang::prelude::*;

#[error_code]
pub enum DripError {
    #[msg("The stream id must be greater than zero.")]
    InvalidStreamId,
    #[msg("The stream rate must be greater than zero.")]
    InvalidStreamRate,
    #[msg("The deposit amount must be greater than zero.")]
    InvalidDepositAmount,
    #[msg("The stream is already closed.")]
    StreamClosed,
    #[msg("There is nothing available to claim.")]
    NothingToClaim,
    #[msg("The provided accounts are not authorized for this action.")]
    Unauthorized,
    #[msg("The provided stream accounts do not belong to the same stream.")]
    StreamAccountMismatch,
    #[msg("A checked math operation overflowed.")]
    MathOverflow,
    #[msg("The vault cannot satisfy the requested transfer.")]
    InsufficientVaultBalance,
    #[msg("The stream accounting invariant was violated.")]
    AccountingInvariantViolated,
}
