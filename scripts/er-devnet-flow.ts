import * as anchor from "@coral-xyz/anchor";
import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import {
  deriveDelegateAccounts,
  deriveStreamPdas,
  ensureBalance,
  formatLamports,
  loadKeypair,
  loadProgram,
  loadRuntimeConfig,
  makeErConnection,
  makeL1Connection,
  sleep,
  waitForDelegationStatus,
  waitForOwnerProgram,
} from "./lib/dripClient";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();

  const payerKeypair = loadKeypair(config.walletPath);
  const receiverKeypair = config.receiverWalletPath
    ? loadKeypair(config.receiverWalletPath)
    : payerKeypair;
  const receiver = config.receiver ?? receiverKeypair.publicKey;

  const payerWallet = new anchor.Wallet(payerKeypair);
  const receiverWallet = new anchor.Wallet(receiverKeypair);
  const l1Connection = makeL1Connection(config.l1RpcUrl);
  const erConnection = makeErConnection(config.erRpcUrl, config.erWsUrl);
  const l1Program = loadProgram(l1Connection, payerWallet);
  const erProgram = loadProgram(erConnection, payerWallet);
  const l1ReceiverProgram = loadProgram(l1Connection, receiverWallet);
  const erReceiverProgram = loadProgram(erConnection, receiverWallet);

  const { streamVault, streamState } = deriveStreamPdas(
    config.streamId,
    l1Program.programId
  );
  const delegateAccounts = deriveDelegateAccounts(
    streamState,
    l1Program.programId
  );

  console.log("Using program:", l1Program.programId.toBase58());
  console.log("Payer:", payerWallet.publicKey.toBase58());
  console.log("Receiver:", receiver.toBase58());
  console.log("Stream vault:", streamVault.toBase58());
  console.log("Stream state:", streamState.toBase58());
  console.log("Rate:", `${config.rateLamportsPerSec.toString()} lamports/sec`);
  console.log("Deposit:", formatLamports(config.depositLamports));

  await ensureBalance(
    l1Connection,
    payerWallet.publicKey,
    config.depositLamports.add(new anchor.BN(500_000))
  );

  console.log("\n1. Opening stream on L1...");
  const openSignature = await l1Program.methods
    .openStream({
      streamId: config.streamId,
      rateLamportsPerSec: config.rateLamportsPerSec,
      depositLamports: config.depositLamports,
    })
    .accountsStrict({
      payer: payerWallet.publicKey,
      receiver,
      streamVault,
      streamState,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("open_stream signature:", openSignature);

  console.log("\n2. Delegating stream state to MagicBlock...");
  const delegateSignature = await l1Program.methods
    .delegateStreamState({
      validator: config.validator ?? null,
      commitFrequencyMs: config.commitFrequencyMs,
    })
    .accountsStrict({
      payer: payerWallet.publicKey,
      streamVault,
      ...delegateAccounts,
      streamState,
    })
    .rpc();
  console.log("delegate_stream_state signature:", delegateSignature);

  await waitForDelegationStatus(erConnection, streamState, true);
  console.log("Delegation confirmed on ER.");

  console.log("\n3. Waiting for the stream to accrue...");
  await sleep(config.tickDelayMs);

  console.log("\n4. Ticking the stream through the ER provider...");
  const tickSignature = await erProgram.methods
    .tickStream()
    .accountsStrict({
      crank: payerWallet.publicKey,
      streamVault,
      streamState,
    })
    .rpc();
  console.log("tick_stream signature:", tickSignature);

  const stateAfterTick = await erProgram.account.streamState.fetch(streamState);
  console.log(
    "Claimable after tick:",
    formatLamports(stateAfterTick.receiverClaimable)
  );

  if (config.claimMode === "er") {
    console.log("\n5. Committing delegated state for a mid-stream claim...");
    const commitSignature = await erReceiverProgram.methods
      .commitStreamState()
      .accountsStrict({
        payer: receiverWallet.publicKey,
        streamVault,
        streamState,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .rpc();
    console.log("commit_stream_state signature:", commitSignature);

    await sleep(1_500);

    console.log("\n6. Settling the committed claim on L1...");
    const claimSignature = await l1ReceiverProgram.methods
      .claim()
      .accountsStrict({
        receiverAuthority: receiverWallet.publicKey,
        receiver,
        streamVault,
        streamState,
      })
      .rpc();
    console.log("claim signature:", claimSignature);

    const vaultAfterClaim = await l1Program.account.streamVault.fetch(
      streamVault
    );
    console.log(
      "Total claimed after claim:",
      formatLamports(vaultAfterClaim.claimed)
    );
  } else {
    console.log(
      "\n5. Skipping mid-stream claim. The stronger path is now ER commit followed by L1 claim settlement."
    );
  }

  console.log(`\n${config.claimMode === "er" ? "7" : "6"}. Scheduling commit + undelegate...`);
  const undelegateSignature = await erProgram.methods
    .undelegateStreamState()
    .accountsStrict({
      payer: payerWallet.publicKey,
      streamVault,
      streamState,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .rpc();
  console.log("undelegate_stream_state signature:", undelegateSignature);

  await waitForDelegationStatus(erConnection, streamState, false);
  console.log("Undelegation confirmed.");
  await waitForOwnerProgram(l1Connection, streamState, l1Program.programId);
  console.log("Base-layer ownership restored.");

  console.log(`\n${config.claimMode === "er" ? "8" : "7"}. Closing stream on L1...`);
  const closeSignature = await l1Program.methods
    .closeStream()
    .accountsStrict({
      authority: payerWallet.publicKey,
      payer: payerWallet.publicKey,
      receiver,
      streamVault,
      streamState,
    })
    .rpc();
  console.log("close_stream signature:", closeSignature);

  console.log("\nFlow complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
