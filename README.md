# Drip Protocol

**Drip** is a Solana program for **continuous SOL streaming**: a payer funds a vault, time accrues owed lamports at a fixed rate, and the receiver can **claim** along the way or you can **close** the stream to settle. Optional **MagicBlock ephemeral rollup** instructions let you **delegate** stream state to an ER for faster **ticks** and **commit** state back to L1—useful for demos and low-latency UX.

This repository contains the **on-chain program** (Anchor/Rust), **TypeScript tests**, a **devnet CLI flow** script, and a **Next.js** wallet UI under `drip-ui/`.

## Key features

### On-chain (`programs/drip-protocol`)

| Instruction | Role |
|-------------|------|
| `open_stream` | Create stream PDAs, deposit lamports, set rate (lamports/sec) |
| `tick_stream` | Advance accrued balance from time |
| `claim` | Receiver pulls claimable lamports |
| `close_stream` | End stream; settle vault between receiver and payer |
| `delegate_stream_state` | Delegate accounts to ephemeral rollup (MagicBlock) |
| `commit_stream_state` | Commit rollup state to L1 |
| `undelegate_stream_state` | Undelegate stream state |

The program uses `ephemeral-rollups-sdk` with Anchor’s `#[ephemeral]` attribute for ER-compatible entrypoints.

### Tooling

- **Anchor integration tests** — `tests/drip-protocol.ts` (open → tick → claim → close on local validator).
- **`yarn drip:devnet-flow`** — End-to-end TypeScript script (`scripts/er-devnet-flow.ts`) for L1 + ER against configurable RPCs (see `scripts/lib/dripClient.ts` and runtime config).
- **`drip-ui/`** — Browser UI: connect wallet, open/delegate/tick/claim/close on **devnet** (see [drip-ui/README.md](drip-ui/README.md)).

## Tech stack

| Layer | Technologies |
|-------|----------------|
| Program | Rust, [Anchor](https://www.anchor-lang.com/) 0.31.x, `anchor-lang`, `ephemeral-rollups-sdk` |
| Tests / scripts | TypeScript, `@coral-xyz/anchor`, `@magicblock-labs/ephemeral-rollups-sdk`, Mocha |
| Frontend | Next.js 16, React 19, Tailwind 4, Solana wallet adapter, Anchor client (see `drip-ui`) |
| Package manager | **Yarn** (see `Anchor.toml` `package_manager` and root `yarn.lock`) |

Declared program id: `2zpBm2o5Sxw1GXpH4eSvqVqVLUPphfpM2BxADg2g7B5c` (see `programs/drip-protocol/src/lib.rs`).

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) + Cargo
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) aligned with your Anchor version
- [Anchor](https://www.anchor-lang.com/docs/installation) (version compatible with `Anchor.toml` / `Cargo.toml` deps)
- **Node.js** 20+ and **Yarn** for JS tooling at the repo root

## Installation

From the repository root:

```bash
yarn install
```

Build the program and generate the IDL/types:

```bash
anchor build
```

For the web app (separate install):

```bash
cd drip-ui && npm install
```

Copy or symlink the generated IDL into the UI when you change the program (the UI expects `drip-ui/lib/generated/drip_protocol.json`; regenerate after `anchor build` if your workflow publishes the IDL there).

## Usage

### Run Anchor tests (localnet)

Uses the provider in `Anchor.toml` (default **localnet** with wallet `~/.config/solana/id.json`):

```bash
anchor test
```

Ensure `solana-test-validator` is available; Anchor typically starts it for tests depending on your setup.

### Devnet + ephemeral rollup CLI flow

Requires **`anchor build`** first (uses `target/types/drip_protocol`). Set at least **`ANCHOR_WALLET`** to your keypair JSON path (same convention as Anchor). Optional env vars: `DRIP_L1_RPC_URL`, `DRIP_ER_RPC_URL`, `DRIP_ER_WS_URL`, `DRIP_STREAM_ID`, `DRIP_RATE_LAMPORTS_PER_SEC`, `DRIP_DEPOSIT_LAMPORTS`, `DRIP_RECEIVER`, etc. — see `loadRuntimeConfig()` in `scripts/lib/dripClient.ts`.

```bash
export ANCHOR_WALLET=$HOME/.config/solana/id.json
yarn drip:devnet-flow
```

This exercises the full open → delegate → tick → commit/undelegate style flow against devnet-compatible endpoints.

### Web UI (devnet)

```bash
cd drip-ui && npm run dev
```

Open [http://localhost:3000](http://localhost:3000), switch the wallet to **devnet**, fund the payer, and use the streaming UI. Details: [drip-ui/README.md](drip-ui/README.md).

### Other root scripts

```bash
yarn lint          # Prettier check
yarn lint:fix      # Prettier write
yarn typecheck     # TypeScript --noEmit (project tsconfig)
```

## Project structure

```
.
├── Anchor.toml                 # Anchor workspace + scripts (e.g. test runner)
├── Cargo.toml                  # Rust workspace (programs/*)
├── programs/drip-protocol/     # Anchor program crate
├── tests/                      # TS/Mocha Anchor tests
├── scripts/                    # Devnet ER flow + shared dripClient helpers
├── drip-ui/                    # Next.js frontend
├── package.json                # Root JS scripts and shared dev deps
└── yarn.lock
```

