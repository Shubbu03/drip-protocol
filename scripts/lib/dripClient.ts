import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { readFileSync } from "fs";
import { resolve } from "path";

import type { DripProtocol } from "../../target/types/drip_protocol";

export const DEFAULT_L1_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_ER_RPC_URL = "https://devnet.magicblock.app";
export const DEFAULT_ER_WS_URL = "wss://devnet.magicblock.app";
export const STREAM_VAULT_SEED = Buffer.from("vault");
export const STREAM_STATE_SEED = Buffer.from("stream");

export type DripProgram = anchor.Program<DripProtocol>;

export type StreamPdas = {
  streamVault: PublicKey;
  streamState: PublicKey;
};

export type DelegateAccounts = {
  bufferStreamState: PublicKey;
  delegationRecordStreamState: PublicKey;
  delegationMetadataStreamState: PublicKey;
  ownerProgram: PublicKey;
  delegationProgram: PublicKey;
  systemProgram: PublicKey;
};

export type RuntimeConfig = {
  l1RpcUrl: string;
  erRpcUrl: string;
  erWsUrl: string;
  walletPath: string;
  receiverWalletPath?: string;
  receiver?: PublicKey;
  streamId: anchor.BN;
  rateLamportsPerSec: anchor.BN;
  depositLamports: anchor.BN;
  tickDelayMs: number;
  validator?: PublicKey;
  commitFrequencyMs: number;
  claimMode: "none" | "er";
};

export function loadRuntimeConfig(): RuntimeConfig {
  const walletPath = getRequiredEnv("ANCHOR_WALLET");
  const receiverWalletPath = process.env.DRIP_RECEIVER_WALLET;
  const receiver = process.env.DRIP_RECEIVER
    ? new PublicKey(process.env.DRIP_RECEIVER)
    : undefined;

  return {
    l1RpcUrl: process.env.DRIP_L1_RPC_URL ?? DEFAULT_L1_RPC_URL,
    erRpcUrl: process.env.DRIP_ER_RPC_URL ?? DEFAULT_ER_RPC_URL,
    erWsUrl: process.env.DRIP_ER_WS_URL ?? DEFAULT_ER_WS_URL,
    walletPath,
    receiverWalletPath,
    receiver,
    streamId: new anchor.BN(
      process.env.DRIP_STREAM_ID ?? Date.now().toString(),
      10
    ),
    rateLamportsPerSec: new anchor.BN(
      process.env.DRIP_RATE_LAMPORTS_PER_SEC ?? "1000000",
      10
    ),
    depositLamports: new anchor.BN(
      process.env.DRIP_DEPOSIT_LAMPORTS ?? "5000000",
      10
    ),
    tickDelayMs: Number(process.env.DRIP_TICK_DELAY_MS ?? "1500"),
    validator: process.env.DRIP_VALIDATOR
      ? new PublicKey(process.env.DRIP_VALIDATOR)
      : undefined,
    commitFrequencyMs: Number(process.env.DRIP_COMMIT_FREQUENCY_MS ?? "10000"),
    claimMode: process.env.DRIP_CLAIM_MODE === "er" ? "er" : "none",
  };
}

export function loadKeypair(keypairPath: string): Keypair {
  const secret = JSON.parse(
    readFileSync(resolve(keypairPath), "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function loadProgram(
  connection: Connection,
  wallet: anchor.Wallet
): DripProgram {
  const idl = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../target/idl/drip_protocol.json"),
      "utf8"
    )
  ) as DripProtocol;
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  return new anchor.Program<DripProtocol>(idl, provider);
}

export function makeL1Connection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
  });
}

export function makeErConnection(
  rpcUrl: string,
  wsUrl: string
): ConnectionMagicRouter {
  return new ConnectionMagicRouter(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wsUrl,
  });
}

export function deriveStreamPdas(
  streamId: anchor.BN,
  programId: PublicKey
): StreamPdas {
  const streamIdSeed = streamId.toArrayLike(Buffer, "le", 8);
  const [streamVault] = PublicKey.findProgramAddressSync(
    [STREAM_VAULT_SEED, streamIdSeed],
    programId
  );
  const [streamState] = PublicKey.findProgramAddressSync(
    [STREAM_STATE_SEED, streamIdSeed],
    programId
  );

  return { streamVault, streamState };
}

export function deriveDelegateAccounts(
  delegatedAccount: PublicKey,
  ownerProgram: PublicKey
): DelegateAccounts {
  return {
    bufferStreamState: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      delegatedAccount,
      ownerProgram
    ),
    delegationRecordStreamState:
      delegationRecordPdaFromDelegatedAccount(delegatedAccount),
    delegationMetadataStreamState:
      delegationMetadataPdaFromDelegatedAccount(delegatedAccount),
    ownerProgram,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

export async function waitForDelegationStatus(
  erConnection: ConnectionMagicRouter,
  account: PublicKey,
  expected: boolean,
  timeoutMs = 30_000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await erConnection.getDelegationStatus(account);
    if (status.isDelegated === expected) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for delegation status ${expected} for ${account.toBase58()}.`
  );
}

export async function waitForOwnerProgram(
  connection: Connection,
  account: PublicKey,
  ownerProgram: PublicKey,
  timeoutMs = 30_000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const accountInfo = await connection.getAccountInfo(account, "confirmed");
    if (accountInfo?.owner.equals(ownerProgram)) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for ${account.toBase58()} to return to owner ${ownerProgram.toBase58()}.`
  );
}

export async function ensureBalance(
  connection: Connection,
  account: PublicKey,
  minimumLamports: anchor.BN
): Promise<void> {
  const balance = await connection.getBalance(account, "confirmed");
  if (balance < minimumLamports.toNumber()) {
    throw new Error(
      `Wallet ${account.toBase58()} has ${balance} lamports, needs at least ${minimumLamports.toString()}.`
    );
  }
}

export function formatLamports(lamports: anchor.BN | number | bigint): string {
  const amount =
    typeof lamports === "number"
      ? lamports
      : typeof lamports === "bigint"
      ? Number(lamports)
      : lamports.toNumber();

  return `${(amount / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}
