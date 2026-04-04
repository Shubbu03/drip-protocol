"use client";

import { CaretDown, CheckCircle, Wallet, XCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WalletActionButton() {
  const {
    connected,
    connect,
    connecting,
    disconnect,
    publicKey,
    select,
    wallet,
    wallets,
  } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingWalletName || !wallet || connected) {
      return;
    }

    if (wallet.adapter.name !== pendingWalletName) {
      return;
    }

    void connect()
      .then(() => {
        setMenuOpen(false);
        setPendingWalletName(null);
      })
      .catch(() => {
        setPendingWalletName(null);
      });
  }, [connect, connected, pendingWalletName, wallet]);

  if (connected && publicKey) {
    return (
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="lg" className="pointer-events-none">
          <CheckCircle weight="fill" className="size-5 text-[color:var(--color-positive)]" />
          {shorten(publicKey.toBase58())}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => void disconnect()}>
          <XCircle className="size-5" />
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="lg"
        onClick={() => setMenuOpen((current) => !current)}
        disabled={connecting}
      >
        <Wallet className="size-5" />
        {connecting ? "Connecting..." : "Connect wallet"}
        <CaretDown
          className={cn("size-4 transition", menuOpen && "rotate-180")}
          weight="bold"
        />
      </Button>

      {menuOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.75rem)] z-30 min-w-[260px] rounded-[1.4rem] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] p-2.5 shadow-[var(--shadow-panel)] backdrop-blur-xl">
          <p className="px-3 pb-2 pt-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-muted-foreground)]">
            Choose wallet
          </p>
          <div className="grid gap-1.5">
            {wallets.map(({ adapter, readyState }) => (
              <button
                key={adapter.name}
                type="button"
                onClick={() => {
                  setPendingWalletName(adapter.name);
                  select(adapter.name);
                }}
                className="flex items-center justify-between rounded-[1rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-3 py-3 text-left transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-panel-strong)]"
              >
                <span>
                  <span className="block text-sm font-semibold text-[color:var(--color-foreground)]">
                    {adapter.name}
                  </span>
                  <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">
                    {readyState === "Installed" ? "Installed" : readyState}
                  </span>
                </span>
                <Wallet className="size-4 text-[color:var(--color-accent)]" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shorten(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
