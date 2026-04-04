import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { DripProtocol } from "../target/types/drip_protocol";

describe("drip-protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.dripProtocol as Program<DripProtocol>;
  const payer = provider.wallet;
  const receiver = anchor.web3.Keypair.generate();

  it("opens, ticks, claims, and closes a stream", async () => {
    const airdropSig = await provider.connection.requestAirdrop(
      receiver.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig);

    const streamId = new BN(Date.now());
    const rateLamportsPerSec = new BN(1_000_000);
    const depositLamports = new BN(5_000_000);

    const [streamVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), streamId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [streamState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stream"), streamId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .openStream({
        streamId,
        rateLamportsPerSec,
        depositLamports,
      })
      .accountsPartial({
        payer: payer.publicKey,
        receiver: receiver.publicKey,
        streamVault,
        streamState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultAfterOpen = await program.account.streamVault.fetch(streamVault);
    const stateAfterOpen = await program.account.streamState.fetch(streamState);

    assert.equal(vaultAfterOpen.streamId.toString(), streamId.toString());
    assert.equal(vaultAfterOpen.claimed.toString(), "0");
    assert.equal(stateAfterOpen.streamedSoFar.toString(), "0");

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await program.methods
      .tickStream()
      .accountsPartial({
        crank: payer.publicKey,
        streamVault,
        streamState,
      })
      .rpc();

    const stateAfterTick = await program.account.streamState.fetch(streamState);
    assert.isTrue(stateAfterTick.streamedSoFar.gt(new BN(0)));
    assert.equal(
      stateAfterTick.receiverClaimable.toString(),
      stateAfterTick.streamedSoFar.toString()
    );

    const receiverBalanceBeforeClaim = await provider.connection.getBalance(
      receiver.publicKey
    );

    await program.methods
      .claim()
      .accountsPartial({
        receiverAuthority: receiver.publicKey,
        receiver: receiver.publicKey,
        streamVault,
        streamState,
      })
      .signers([receiver])
      .rpc();

    const vaultAfterClaim = await program.account.streamVault.fetch(
      streamVault
    );
    const stateAfterClaim = await program.account.streamState.fetch(
      streamState
    );
    const receiverBalanceAfterClaim = await provider.connection.getBalance(
      receiver.publicKey
    );

    assert.equal(
      vaultAfterClaim.claimed.toString(),
      stateAfterTick.streamedSoFar.toString()
    );
    assert.equal(
      stateAfterClaim.receiverClaimable.toString(),
      stateAfterTick.receiverClaimable.toString()
    );
    assert.isTrue(receiverBalanceAfterClaim > receiverBalanceBeforeClaim);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await program.methods
      .tickStream()
      .accountsPartial({
        crank: payer.publicKey,
        streamVault,
        streamState,
      })
      .rpc();

    const stateBeforeClose = await program.account.streamState.fetch(
      streamState
    );
    assert.isTrue(stateBeforeClose.streamedSoFar.gte(vaultAfterClaim.claimed));
    assert.equal(
      stateBeforeClose.receiverClaimable.toString(),
      stateBeforeClose.streamedSoFar.sub(vaultAfterClaim.claimed).toString()
    );

    await program.methods
      .closeStream()
      .accountsPartial({
        authority: receiver.publicKey,
        payer: payer.publicKey,
        receiver: receiver.publicKey,
        streamVault,
        streamState,
      })
      .signers([receiver])
      .rpc();

    const closedVault = await program.account.streamVault.fetchNullable(
      streamVault
    );
    const closedState = await program.account.streamState.fetchNullable(
      streamState
    );

    assert.isNull(closedVault);
    assert.isNull(closedState);
  });
});
