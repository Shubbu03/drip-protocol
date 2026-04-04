import * as anchor from "@coral-xyz/anchor";
import {
  type Idl,
  type Program,
  BorshAccountsCoder,
  AnchorProvider,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import dripIdlJson from "@/lib/generated/drip_protocol.json";

export const DRIP_IDL = dripIdlJson as Idl & { address: string };
export const DRIP_PROGRAM_ID = new PublicKey(DRIP_IDL.address);
export { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID };
export const DEFAULT_L1_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_ER_RPC_URL = "https://devnet.magicblock.app";
export const DEFAULT_ER_WS_URL = "wss://devnet.magicblock.app";
export const STREAM_VAULT_SEED = new TextEncoder().encode("vault");
export const STREAM_STATE_SEED = new TextEncoder().encode("stream");
export const DEFAULT_COMMIT_FREQUENCY_MS = 10_000;
export const AUTO_TICK_AIRDROP_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
export const MIN_BURNER_BALANCE_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
export const BURNER_STORAGE_KEY = "drip-ui.burner";
export const STREAM_STORAGE_KEY = "drip-ui.active-stream";

type WalletLike = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]>;
};

export type TrackedStream = {
  streamId: string;
  streamVault: string;
  streamState: string;
  receiver: string;
  rateLamportsPerSec: number;
  depositLamports: number;
  openSignature?: string;
  delegateSignature?: string;
};

export type StreamLiveData = {
  delegated: boolean;
  status: "idle" | "active" | "closed" | "missing";
  payer: string;
  receiver: string;
  streamId: string;
  rateLamportsPerSec: number;
  depositedLamports: number;
  claimedLamports: number;
  streamedLamports: number;
  claimableLamports: number;
  remainingLamports: number;
  createdAt: number;
  lastTick: number | null;
  streamVault: string;
  streamState: string;
};

export const l1Connection = new Connection(DEFAULT_L1_RPC_URL, {
  commitment: "confirmed",
});

export const erConnection = new ConnectionMagicRouter(DEFAULT_ER_RPC_URL, {
  commitment: "confirmed",
  wsEndpoint: DEFAULT_ER_WS_URL,
});

export class KeypairWallet implements WalletLike {
  constructor(readonly payer: Keypair) {}

  get publicKey() {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T) {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.payer]);
      return transaction;
    }

    transaction.partialSign(this.payer);
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]) {
    return Promise.all(transactions.map((transaction) => this.signTransaction(transaction)));
  }
}

const readonlyWallet = new KeypairWallet(Keypair.generate());
const coder = new BorshAccountsCoder(DRIP_IDL);

export function getProgram(connection: Connection, wallet: WalletLike): Program<Idl> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  return new anchor.Program(DRIP_IDL, provider);
}

export async function fundBurnerWallet(
  wallet: WalletLike,
  burner: PublicKey,
  lamports: number,
) {
  const provider = new AnchorProvider(l1Connection, wallet, {
    commitment: "confirmed",
  });
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: burner,
      lamports,
    }),
  );

  return provider.sendAndConfirm(transaction, []);
}

export function deriveStreamPdas(streamId: anchor.BN) {
  const streamIdSeed = Uint8Array.from(streamId.toArray("le", 8));
  const [streamVault] = PublicKey.findProgramAddressSync(
    [STREAM_VAULT_SEED, streamIdSeed],
    DRIP_PROGRAM_ID,
  );
  const [streamState] = PublicKey.findProgramAddressSync(
    [STREAM_STATE_SEED, streamIdSeed],
    DRIP_PROGRAM_ID,
  );

  return { streamVault, streamState };
}

export function deriveDelegateAccounts(streamState: PublicKey) {
  return {
    bufferStreamState: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      streamState,
      DRIP_PROGRAM_ID,
    ),
    delegationRecordStreamState:
      delegationRecordPdaFromDelegatedAccount(streamState),
    delegationMetadataStreamState:
      delegationMetadataPdaFromDelegatedAccount(streamState),
    ownerProgram: DRIP_PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

export function generateStreamId() {
  return new anchor.BN(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`,
    10,
  );
}

export async function fetchStreamLiveData(
  trackedStream: TrackedStream,
): Promise<StreamLiveData | null> {
  const streamVault = new PublicKey(trackedStream.streamVault);
  const streamState = new PublicKey(trackedStream.streamState);
  const l1Program = getProgram(l1Connection, readonlyWallet);
  const erProgram = getProgram(erConnection, readonlyWallet);
  const vault = await fetchAccountRecord(l1Program, "streamVault", streamVault);
  if (!vault) {
    return null;
  }
  const delegated = await erConnection
    .getDelegationStatus(streamState)
    .then((status) => status.isDelegated)
    .catch(() => false);
  let state = delegated
    ? await fetchAccountRecord(erProgram, "streamState", streamState)
    : await fetchAccountRecord(l1Program, "streamState", streamState);

  if (!state) {
    state = await fetchAccountRecord(erProgram, "streamState", streamState);
  }

  if (!state) {
    state = await fetchAccountRecord(l1Program, "streamState", streamState);
  }

  const depositedLamports = toNumberField(vault, "deposited");
  const claimedLamports = toNumberField(vault, "claimed");
  const streamedLamports = state
    ? toNumberField(state, "streamedSoFar", "streamed_so_far")
    : claimedLamports;
  const claimableLamports = Math.max(0, streamedLamports - claimedLamports);
  const status = getField<unknown>(vault, "status");

  return {
    delegated,
    status: state == null && isClosedStatus(status)
      ? "closed"
      : isClosedStatus(status)
        ? "closed"
        : "active",
    payer: toPublicKeyString(getField(vault, "payer")),
    receiver: toPublicKeyString(getField(vault, "receiver")),
    streamId: toStringField(vault, "streamId", "stream_id"),
    rateLamportsPerSec: toNumberField(
      vault,
      "rateLamportsPerSec",
      "rate_lamports_per_sec",
    ),
    depositedLamports,
    claimedLamports,
    streamedLamports,
    claimableLamports,
    remainingLamports: Math.max(0, depositedLamports - streamedLamports),
    createdAt: toNumberField(vault, "createdAt", "created_at"),
    lastTick: state ? toNumberField(state, "lastTick", "last_tick") : null,
    streamVault: streamVault.toBase58(),
    streamState: streamState.toBase58(),
  };
}

export async function waitForDelegationStatus(
  account: PublicKey,
  expected: boolean,
  timeoutMs = 30_000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const delegated = await erConnection
      .getDelegationStatus(account)
      .then((status) => status.isDelegated)
      .catch(() => false);

    if (delegated === expected) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for delegation status ${expected} for ${account.toBase58()}.`,
  );
}

export async function waitForOwnerProgram(
  account: PublicKey,
  expectedOwner: PublicKey,
  timeoutMs = 30_000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const accountInfo = await l1Connection.getAccountInfo(account, "confirmed");
    if (accountInfo?.owner.equals(expectedOwner)) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for ${account.toBase58()} to return to ${expectedOwner.toBase58()}.`,
  );
}

export async function waitForCommittedStream(streamState: PublicKey, minimumStreamedLamports: number, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const baseState = await fetchBaseStreamState(streamState);
    if (baseState) {
      const streamed = toNumberField(baseState, "streamedSoFar", "streamed_so_far");
      if (streamed >= minimumStreamedLamports) {
        return streamed;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for committed stream state ${streamState.toBase58()} to reach ${minimumStreamedLamports} lamports.`,
  );
}

export function loadStoredStream() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STREAM_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as TrackedStream;
  } catch {
    return null;
  }
}

export function storeTrackedStream(stream: TrackedStream | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!stream) {
    window.localStorage.removeItem(STREAM_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STREAM_STORAGE_KEY, JSON.stringify(stream));
}

export function loadBurnerKeypair() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(BURNER_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored) as number[]));
  } catch {
    return null;
  }
}

export function storeBurnerKeypair(keypair: Keypair) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    BURNER_STORAGE_KEY,
    JSON.stringify(Array.from(keypair.secretKey)),
  );
}

export async function ensureBurnerBalance(keypair: Keypair) {
  const balance = await l1Connection.getBalance(keypair.publicKey, "confirmed");
  if (balance >= MIN_BURNER_BALANCE_LAMPORTS) {
    return balance;
  }

  const signature = await l1Connection.requestAirdrop(
    keypair.publicKey,
    AUTO_TICK_AIRDROP_LAMPORTS,
  );
  const latestBlockhash = await l1Connection.getLatestBlockhash("confirmed");
  await l1Connection.confirmTransaction(
    {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature,
    },
    "confirmed",
  );

  return l1Connection.getBalance(keypair.publicKey, "confirmed");
}

export function lamportsToSol(lamports: number) {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: string) {
  const parsed = Number(sol);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.round(parsed * LAMPORTS_PER_SOL);
}

export function formatSol(lamports: number) {
  return `${lamportsToSol(lamports).toFixed(4)} SOL`;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getField<T>(
  record: Record<string, unknown>,
  camelCase: string,
  snakeCase?: string,
): T | undefined {
  const camelValue = record[camelCase];
  if (camelValue !== undefined) {
    return camelValue as T;
  }

  if (snakeCase) {
    return record[snakeCase] as T | undefined;
  }

  return undefined;
}

function toNumberField(
  record: Record<string, unknown>,
  camelCase: string,
  snakeCase?: string,
) {
  return numericToNumber(getField(record, camelCase, snakeCase), camelCase);
}

function toStringField(
  record: Record<string, unknown>,
  camelCase: string,
  snakeCase?: string,
) {
  const value = getField(record, camelCase, snakeCase);
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    return value.toString();
  }

  throw new Error(`Missing string field ${camelCase}.`);
}

function toPublicKeyString(value: unknown) {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (typeof value === "string") {
    return value;
  }

  throw new Error("Missing public key field.");
}

function numericToNumber(value: unknown, fieldName: string) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber();
  }

  throw new Error(`Missing numeric field ${fieldName}.`);
}

function isClosedStatus(status: unknown) {
  if (typeof status === "string") {
    return status.toLowerCase() === "closed";
  }

  if (status && typeof status === "object") {
    return "closed" in status;
  }

  return false;
}

async function fetchAccountRecord(
  program: Program<Idl>,
  accountName: string,
  address: PublicKey,
) {
  const namespace = (program.account as Record<string, { fetchNullable(address: PublicKey): Promise<unknown> | unknown }>)[
    accountName
  ];
  if (!namespace) {
    return null;
  }

  return (await Promise.resolve(namespace.fetchNullable(address)).catch(() => null)) as
    | Record<string, unknown>
    | null;
}

async function fetchBaseStreamState(streamState: PublicKey) {
  const info = await l1Connection.getAccountInfo(streamState, "confirmed");
  if (!info || info.data.length === 0) {
    return null;
  }

  try {
    return coder.decode("StreamState", info.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
