# Drip UI

Web client for **Drip** — real-time SOL streaming on Solana. Connect a wallet, open a payment stream, delegate it to [MagicBlock](https://magicblock.app/) ephemeral rollups for fast ticks, then claim or close. Built for demos and hackathons; defaults target **Solana devnet**.

## Features

- **Wallet connection** — Phantom and Solflare via `@solana/wallet-adapter-react` (auto-connect to devnet RPC).
- **Open & track streams** — Configure receiver, rate (SOL/sec), and deposit; Anchor-driven transactions against the Drip program.
- **Ephemeral rollups** — Delegate stream state to MagicBlock ER; tick, commit cadence, and activity surfaced in the UI (L1 vs ER vs local actions).
- **Burner keypair (browser)** — Ephemeral signer stored in `localStorage` to pay ER-side fees without prompting the main wallet every tick (with balance checks and airdrop helpers on devnet).
- **Live stream panel** — Claimable vs streamed amounts, status, and optional auto-tick.
- **Persistence** — Active stream and burner metadata restored across reloads (`localStorage` keys documented in `lib/drip-protocol.ts`).

## Tech stack

| Area | Choice |
|------|--------|
| Framework | [Next.js](https://nextjs.org/) 16 (App Router), React 19 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4, `class-variance-authority`, `tailwind-merge` |
| Solana | `@solana/web3.js`, `@coral-xyz/anchor`, generated IDL in `lib/generated/drip_protocol.json` |
| Wallets | `@solana/wallet-adapter-react` (+ Phantom, Solflare) |
| Ephemeral rollups | `@magicblock-labs/ephemeral-rollups-sdk` |
| Icons | `@phosphor-icons/react` |

Dev scripts use `--webpack` for compatibility with the current Solana/Anchor browser bundle graph.

## Prerequisites

- **Node.js** 20+ (or **Bun** — lockfile present)
- A Solana wallet with **devnet SOL** for the payer (faucet: [Solana Faucet](https://faucet.solana.com/))

RPC endpoints are defined in `lib/drip-protocol.ts` (`DEFAULT_L1_RPC_URL`, `DEFAULT_ER_RPC_URL`). There is no `.env` file required for the default devnet setup.

## Installation

```bash
cd drip-ui
bun install
```

(Use `pbun install` or `bun install` if you prefer; the repo includes `bun.lock`.)

## Usage

**Development server**

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect your wallet, ensure you are on **devnet**, then use the UI to open a stream, delegate, tick, claim, or close. Watch the activity feed for signatures and layer tags (L1 / ER / LOCAL).

**Production build**

```bash
bun run build
bun start
```

**Lint**

```bash
bun run lint
```

## Project structure

```
drip-ui/
├── app/                    # Next.js App Router — layout, global styles, home page
├── components/
│   ├── drip-experience.tsx # Main streaming UI and transaction flow
│   ├── providers/          # Solana connection + wallet providers
│   ├── ui/                 # Shared UI primitives (e.g. button)
│   └── wallet-action-button.tsx
├── lib/
│   ├── drip-protocol.ts    # Anchor program helpers, ER wiring, storage keys, RPC
│   ├── generated/
│   │   └── drip_protocol.json  # IDL + program address (keep in sync with on-chain build)
│   └── utils.ts
├── public/                 # Static assets
└── package.json
```

The on-chain program lives alongside this repo under `programs/drip-protocol` (Anchor). After rebuilding the program, regenerate or copy the IDL so `lib/generated/drip_protocol.json` matches the deployed program ID.
