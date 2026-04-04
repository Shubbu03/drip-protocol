"use client";

import * as anchor from "@coral-xyz/anchor";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowSquareOut,
  ArrowUpRight,
  Drop,
  Lightning,
  LockKey,
  Pause,
  Pulse,
  RadioButton,
  Receipt,
  Sparkle,
  Timer,
  Waves,
} from "@phosphor-icons/react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useEffectEvent, useRef, useState, startTransition } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { Button } from "@/components/ui/button";
import { WalletActionButton } from "@/components/wallet-action-button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COMMIT_FREQUENCY_MS,
  DRIP_PROGRAM_ID,
  KeypairWallet,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  type StreamLiveData,
  type TrackedStream,
  AUTO_TICK_AIRDROP_LAMPORTS,
  deriveDelegateAccounts,
  deriveStreamPdas,
  ensureBurnerBalance,
  erConnection,
  fetchStreamLiveData,
  formatSol,
  fundBurnerWallet,
  generateStreamId,
  getProgram,
  l1Connection,
  lamportsToSol,
  loadBurnerKeypair,
  loadStoredStream,
  solToLamports,
  storeBurnerKeypair,
  storeTrackedStream,
  waitForCommittedStream,
  waitForDelegationStatus,
  waitForOwnerProgram,
} from "@/lib/drip-protocol";

const POLL_INTERVAL_MS = 1500;
const AUTO_TICK_INTERVAL_MS = 1400;

type ActivityItem = {
  id: string;
  label: string;
  detail: string;
  layer: "L1" | "ER" | "LOCAL";
  signature?: string;
  href?: string;
};

type BurnerStatus = {
  address: string | null;
  balanceLamports: number;
  ready: boolean;
  error: string | null;
  usingFallback: boolean;
};

type CloseSummary = {
  receiverEarnedLamports: number;
  payerRefundLamports: number;
  closeSignature: string;
};

export function DripExperience() {
  const anchorWallet = useAnchorWallet();
  const { connected, publicKey } = useWallet();
  const storedBurnerKeypair = loadBurnerKeypair();

  const [receiver, setReceiver] = useState("");
  const [rateInput, setRateInput] = useState("0.0010");
  const [depositInput, setDepositInput] = useState("0.50");
  const [trackedStream, setTrackedStream] = useState<TrackedStream | null>(() =>
    loadStoredStream(),
  );
  const [streamData, setStreamData] = useState<StreamLiveData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<"open" | "active">(() =>
    loadStoredStream() ? "active" : "open",
  );
  const [busyAction, setBusyAction] = useState<
    null | "open" | "refresh" | "tick" | "claim" | "close"
  >(null);
  const [statusMessage, setStatusMessage] = useState(
    "Connect a wallet to open and delegate a real stream on devnet.",
  );
  const [autoTickEnabled, setAutoTickEnabled] = useState(true);
  const [burnerStatus, setBurnerStatus] = useState<BurnerStatus>(() => {
    return {
      address: storedBurnerKeypair?.publicKey.toBase58() ?? null,
      balanceLamports: 0,
      ready: false,
      error: null,
      usingFallback: false,
    };
  });
  const [closeSummary, setCloseSummary] = useState<CloseSummary | null>(null);

  const burnerRef = useRef<KeypairWallet | null>(
    storedBurnerKeypair ? new KeypairWallet(storedBurnerKeypair) : null,
  );
  const tickInFlightRef = useRef(false);

  const rateLamports = solToLamports(rateInput);
  const depositLamports = solToLamports(depositInput);
  const previewDurationSeconds =
    rateLamports > 0 ? depositLamports / rateLamports : 0;

  const appendActivity = (entry: ActivityItem) => {
    startTransition(() => {
      setActivity((current) => [entry, ...current].slice(0, 8));
    });
  };

  const refreshTrackedStream = async () => {
    if (!trackedStream) {
      startTransition(() => {
        setStreamData(null);
      });
      return;
    }

    try {
      const nextData = await fetchStreamLiveData(trackedStream);
      startTransition(() => {
        setStreamData(nextData);
        if (!nextData) {
          setStatusMessage("The tracked stream account is no longer available on devnet.");
        }
      });
    } catch (error) {
      startTransition(() => {
        setStatusMessage(getErrorMessage(error));
      });
    }
  };

  const primeBurner = async () => {
    let burner = burnerRef.current;
    if (!burner) {
      burner = generateBurnerWallet();
      burnerRef.current = burner;
      storeBurnerKeypair(burner.payer);
    }

    try {
      const balance = await ensureBurnerBalance(burner.payer);
      startTransition(() => {
        setBurnerStatus({
          address: burner.publicKey.toBase58(),
          balanceLamports: balance,
          ready: true,
          error: null,
          usingFallback: false,
        });
      });
    } catch (error) {
      if (anchorWallet && publicKey) {
        try {
          const signature = await fundBurnerWallet(
            anchorWallet,
            burner.publicKey,
            AUTO_TICK_AIRDROP_LAMPORTS,
          );
          const fundedBalance = await l1Connection.getBalance(
            burner.publicKey,
            "confirmed",
          );

          appendActivity({
            id: `fund-burner-${signature}`,
            label: "Burner funded from wallet",
            detail: "Faucet funding was unavailable, so the connected wallet topped up the burner for automatic ER ticks.",
            layer: "L1",
            signature,
            href: explorerUrl(signature),
          });

          startTransition(() => {
            setBurnerStatus({
              address: burner.publicKey.toBase58(),
              balanceLamports: fundedBalance,
              ready: true,
              error: null,
              usingFallback: false,
            });
          });

          return burner;
        } catch (fundError) {
          startTransition(() => {
            setBurnerStatus({
              address: burner.publicKey.toBase58(),
              balanceLamports: 0,
              ready: false,
              error: getErrorMessage(fundError),
              usingFallback: false,
            });
          });
          throw fundError;
        }
      }

      startTransition(() => {
        setBurnerStatus({
          address: burner.publicKey.toBase58(),
          balanceLamports: 0,
          ready: false,
          error: getErrorMessage(error),
          usingFallback: false,
        });
      });
      throw error;
    }

    return burner;
  };

  const tickStream = async (mode: "manual" | "auto") => {
    if (!trackedStream || !streamData || streamData.status !== "active") {
      return;
    }

    if (tickInFlightRef.current) {
      return;
    }

    tickInFlightRef.current = true;
    if (mode === "manual") {
      startTransition(() => {
        setBusyAction("tick");
      });
    }

    try {
      let tickWallet: Parameters<typeof getProgram>[1] | null = null;
      let crank: PublicKey | null = null;

      if (mode === "auto") {
        let burner = burnerRef.current;
        if (burnerStatus.ready && burner) {
          tickWallet = burner;
          crank = burner.publicKey;
        } else {
          try {
            burner = await primeBurner();
            if (burner) {
              tickWallet = burner;
              crank = burner.publicKey;
            }
          } catch {
            if (anchorWallet && publicKey) {
              tickWallet = anchorWallet;
              crank = publicKey;
              startTransition(() => {
                setBurnerStatus((current) => ({
                  ...current,
                  ready: false,
                  error: null,
                  usingFallback: true,
                }));
              });
            }
          }
        }
      }

      if (!tickWallet && anchorWallet && publicKey) {
        tickWallet = anchorWallet;
        crank = publicKey;
      }

      if (!tickWallet || !crank) {
        throw new Error("No signer is available to submit a real ER tick.");
      }

      const erProgram = getProgram(erConnection, tickWallet);
      const signature = await erProgram.methods
        .tickStream()
        .accountsStrict({
          crank,
          streamVault: new PublicKey(trackedStream.streamVault),
          streamState: new PublicKey(trackedStream.streamState),
        })
        .rpc();

      appendActivity({
        id: `tick-${signature}`,
        label: mode === "auto" ? "Auto tick submitted" : "Manual ER tick submitted",
        detail: "A real tick transaction hit the delegated stream state on MagicBlock.",
        layer: "ER",
        signature,
      });

      await refreshTrackedStream();
    } catch (error) {
      if (mode === "manual") {
        startTransition(() => {
          setStatusMessage(getErrorMessage(error));
        });
      } else {
        startTransition(() => {
          setBurnerStatus((current) => ({
            ...current,
            ready: false,
            error: getErrorMessage(error),
            usingFallback: false,
          }));
        });
      }
    } finally {
      tickInFlightRef.current = false;
      if (mode === "manual") {
        startTransition(() => {
          setBusyAction(null);
        });
      }
    }
  };

  const refreshTrackedStreamEvent = useEffectEvent(() => {
    void refreshTrackedStream();
  });

  const tickStreamEvent = useEffectEvent((mode: "manual" | "auto") => {
    void tickStream(mode);
  });

  const primeBurnerEvent = useEffectEvent(() => {
    void primeBurner();
  });

  useEffect(() => {
    storeTrackedStream(trackedStream);
  }, [trackedStream]);

  useEffect(() => {
    if (!trackedStream) {
      return;
    }

    const initial = window.setTimeout(() => {
      refreshTrackedStreamEvent();
    }, 0);
    const interval = window.setInterval(() => {
      refreshTrackedStreamEvent();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [trackedStream]);

  useEffect(() => {
    if (!trackedStream || !autoTickEnabled) {
      return;
    }

    if (!streamData || !streamData.delegated || streamData.status !== "active") {
      return;
    }

    const interval = window.setInterval(() => {
      tickStreamEvent("auto");
    }, AUTO_TICK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoTickEnabled, streamData, trackedStream]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const initial = window.setTimeout(() => {
      primeBurnerEvent();
    }, 0);

    return () => window.clearTimeout(initial);
  }, [connected]);

  const startStream = async () => {
    if (!anchorWallet || !publicKey) {
      setStatusMessage("Connect a Solana wallet before opening a real stream.");
      return;
    }

    const receiverText = receiver.trim();
    if (!receiverText) {
      setStatusMessage("Enter a real receiver address.");
      return;
    }

    let receiverKey: PublicKey;
    try {
      receiverKey = new PublicKey(receiverText);
    } catch {
      setStatusMessage("Receiver must be a valid Solana address.");
      return;
    }

    if (rateLamports <= 0 || depositLamports <= 0) {
      setStatusMessage("Rate and deposit must both be positive.");
      return;
    }

    setBusyAction("open");
    setStatusMessage("Opening and delegating a real devnet stream...");

    try {
      const streamId = generateStreamId();
      const { streamVault, streamState } = deriveStreamPdas(streamId);
      const l1Program = getProgram(l1Connection, anchorWallet);

      const openSignature = await l1Program.methods
        .openStream({
          streamId,
          rateLamportsPerSec: new anchor.BN(rateLamports),
          depositLamports: new anchor.BN(depositLamports),
        })
        .accountsStrict({
          payer: publicKey,
          receiver: receiverKey,
          streamVault,
          streamState,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const delegateSignature = await l1Program.methods
        .delegateStreamState({
          validator: null,
          commitFrequencyMs: DEFAULT_COMMIT_FREQUENCY_MS,
        })
        .accountsStrict({
          payer: publicKey,
          streamVault,
          ...deriveDelegateAccounts(streamState),
          streamState,
        })
        .rpc();

      const nextTrackedStream: TrackedStream = {
        streamId: streamId.toString(),
        streamVault: streamVault.toBase58(),
        streamState: streamState.toBase58(),
        receiver: receiverKey.toBase58(),
        rateLamportsPerSec: rateLamports,
        depositLamports,
        openSignature,
        delegateSignature,
      };

      startTransition(() => {
        setSelectedPanel("active");
        setTrackedStream(nextTrackedStream);
        setCloseSummary(null);
        setStatusMessage("Stream is live on devnet and delegated to MagicBlock.");
      });

      appendActivity({
        id: `open-${openSignature}`,
        label: "Stream opened on base layer",
        detail: `${formatSol(depositLamports)} locked for ${receiverKey.toBase58()}.`,
        layer: "L1",
        signature: openSignature,
        href: explorerUrl(openSignature),
      });
      appendActivity({
        id: `delegate-${delegateSignature}`,
        label: "Delegated to ER",
        detail: "The stream state is now live on MagicBlock for fast ticking.",
        layer: "L1",
        signature: delegateSignature,
        href: explorerUrl(delegateSignature),
      });

      await waitForDelegationStatus(streamState, true);
      await refreshTrackedStream();
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const refreshNow = async () => {
    if (!trackedStream) {
      setStatusMessage("Open or restore a stream before polling real data.");
      return;
    }

    setBusyAction("refresh");
    try {
      await refreshTrackedStream();
      setStatusMessage("Pulled the latest stream state from devnet.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const closeStream = async () => {
    if (!trackedStream || !anchorWallet || !publicKey) {
      setStatusMessage("Connect the payer wallet before closing a stream.");
      return;
    }

    setBusyAction("close");
    setStatusMessage("Undelegating on ER and finalizing close on base layer...");

    try {
      const streamVault = new PublicKey(trackedStream.streamVault);
      const streamState = new PublicKey(trackedStream.streamState);
      const receiverKey = new PublicKey(trackedStream.receiver);
      const erProgram = getProgram(erConnection, anchorWallet);
      const l1Program = getProgram(l1Connection, anchorWallet);
      const closingSnapshot = streamData;

      if (streamData?.delegated) {
        const undelegateSignature = await erProgram.methods
          .undelegateStreamState()
          .accountsStrict({
            payer: publicKey,
            streamVault,
            streamState,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          })
          .rpc();

        appendActivity({
          id: `undelegate-${undelegateSignature}`,
          label: "Commit + undelegate scheduled",
          detail: "MagicBlock accepted the request to return stream ownership to L1.",
          layer: "ER",
          signature: undelegateSignature,
        });

        await waitForDelegationStatus(streamState, false);
        await waitForOwnerProgram(streamState, DRIP_PROGRAM_ID);
      }

      const closeSignature = await l1Program.methods
        .closeStream()
        .accountsStrict({
          authority: publicKey,
          payer: publicKey,
          receiver: receiverKey,
          streamVault,
          streamState,
        })
        .rpc();

      appendActivity({
        id: `close-${closeSignature}`,
        label: "Stream closed on base layer",
        detail: "Final settlement was written back to the vault and payer refund path.",
        layer: "L1",
        signature: closeSignature,
        href: explorerUrl(closeSignature),
      });

      startTransition(() => {
        setTrackedStream(null);
        setStreamData(null);
        setCloseSummary({
          receiverEarnedLamports: closingSnapshot?.streamedLamports ?? 0,
          payerRefundLamports: closingSnapshot?.remainingLamports ?? 0,
          closeSignature,
        });
        setStatusMessage("The stream closed successfully on devnet.");
      });
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const claimStream = async () => {
    if (!trackedStream || !anchorWallet || !publicKey) {
      setStatusMessage("Connect the receiver wallet before claiming.");
      return;
    }

    if (!publicKey.equals(new PublicKey(trackedStream.receiver))) {
      setStatusMessage("Switch to the receiver wallet to claim accrued funds.");
      return;
    }

    setBusyAction("claim");
    setStatusMessage("Committing ER state and settling the claim on base layer...");

    try {
      const streamVault = new PublicKey(trackedStream.streamVault);
      const streamState = new PublicKey(trackedStream.streamState);
      const erProgram = getProgram(erConnection, anchorWallet);
      const l1Program = getProgram(l1Connection, anchorWallet);
      const expectedStreamedLamports = streamData?.streamedLamports ?? 0;

      if (streamData?.delegated) {
        const commitSignature = await erProgram.methods
          .commitStreamState()
          .accountsStrict({
            payer: publicKey,
            streamVault,
            streamState,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          })
          .rpc();

        appendActivity({
          id: `commit-${commitSignature}`,
          label: "ER state committed for claim",
          detail: "The delegated stream state was committed back to the base account before settlement.",
          layer: "ER",
          signature: commitSignature,
        });

        await waitForCommittedStream(streamState, expectedStreamedLamports);
      }

      const claimSignature = await l1Program.methods
        .claim()
        .accountsStrict({
          receiverAuthority: publicKey,
          receiver: publicKey,
          streamVault,
          streamState,
        })
        .rpc();

      appendActivity({
        id: `claim-${claimSignature}`,
        label: "Claim settled on base layer",
        detail: "Accrued funds were paid out while the stream stayed delegated for future ticks.",
        layer: "L1",
        signature: claimSignature,
        href: explorerUrl(claimSignature),
      });

      await refreshTrackedStream();
      setStatusMessage("Claim settled successfully.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const activePayerDisplay = streamData
    ? formatSol(streamData.remainingLamports)
    : formatSol(depositLamports);
  const activeReceiverDisplay = streamData
    ? formatSol(streamData.claimableLamports)
    : "0.0000 SOL";
  const activeElapsed = streamData
    ? formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - streamData.createdAt))
    : formatDuration(previewDurationSeconds);
  const autoTickLabel = !autoTickEnabled
    ? "Manual only"
    : burnerStatus.ready
      ? burnerStatus.balanceLamports > 0
        ? "Burner live"
        : "Auto armed"
      : burnerStatus.usingFallback
        ? "Wallet fallback"
        : "Priming";
  const isReceiverWallet =
    !!publicKey &&
    !!trackedStream &&
    publicKey.equals(new PublicKey(trackedStream.receiver));

  return (
    <div className="relative isolate overflow-hidden">
      <BackgroundWash />
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="panel-grid relative overflow-hidden rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/90 p-5 shadow-[var(--shadow-panel)] backdrop-blur-xl sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-accent-soft),transparent)]" />
          <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)] xl:gap-10">
            <div className="space-y-7">
              <div className="flex flex-wrap items-center gap-3 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--color-muted-foreground)]">
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5">
                  <Drop weight="fill" className="size-3.5 text-[color:var(--color-accent)]" />
                  Drip protocol
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-panel-strong)] px-3 py-1.5">
                  <RadioButton
                    weight="fill"
                    className={cn(
                      "size-3.5",
                      streamData?.delegated
                        ? "text-[color:var(--color-positive)]"
                        : "text-[color:var(--color-muted-foreground)]",
                    )}
                  />
                  {streamData?.delegated ? "ER delegated" : "Base layer only"}
                </span>
              </div>

              <div className="space-y-4">
                <p className="max-w-[14ch] font-display text-[clamp(3.4rem,9vw,7.8rem)] leading-[0.88] tracking-[-0.06em] text-[color:var(--color-foreground)]">
                  Real stream. Real polling. Real devnet state.
                </p>
                <p className="max-w-2xl text-[clamp(1rem,1rem+0.6vw,1.28rem)] leading-8 text-[color:var(--color-muted-foreground)]">
                  This pass removes local simulation completely. Every balance shown
                  below is fetched from the actual `StreamVault` and `StreamState`
                  accounts on Solana devnet and MagicBlock.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricTile
                  icon={Lightning}
                  label="Transport"
                  value="Authentic"
                  detail="Numbers come from live account polling, not inferred animation."
                />
                <MetricTile
                  icon={Waves}
                  label="Tick source"
                  value={autoTickEnabled ? "Auto" : "Manual"}
                  detail="Auto mode prefers a burner wallet and falls back to your connected wallet if faucet funding is unavailable."
                />
                <MetricTile
                  icon={Receipt}
                  label="Claim path"
                  value="Commit + settle"
                  detail="Mid-stream claims commit delegated state back to L1 and settle from the vault without undelegating."
                />
              </div>
            </div>

            <div className="rounded-[1.7rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted-foreground)]">
                    Operator state
                  </p>
                  <p className="mt-2 font-display text-3xl tracking-[-0.05em]">
                    Devnet ready.
                  </p>
                </div>
                <div className="flex size-14 items-center justify-center rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]">
                  <Sparkle weight="fill" className="size-7" />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <WalletActionButton />
                <Button
                  variant={autoTickEnabled ? "primary" : "secondary"}
                  size="lg"
                  onClick={() => setAutoTickEnabled((current) => !current)}
                >
                  <Pulse className="size-5" />
                  {autoTickEnabled ? "Auto tick on" : "Auto tick off"}
                </Button>
              </div>

              <div className="mt-6 space-y-3">
                <StatusRow
                  label="Program"
                  value={shorten(DRIP_PROGRAM_ID.toBase58())}
                  icon={LockKey}
                />
                <StatusRow
                  label="Burner crank"
                  value={
                    burnerStatus.address
                      ? `${shorten(burnerStatus.address)} • ${lamportsToSol(
                          burnerStatus.balanceLamports,
                        ).toFixed(3)} SOL${burnerStatus.usingFallback ? " • fallback" : ""}`
                      : "Not initialized"
                  }
                  icon={Timer}
                />
                <StatusRow
                  label="Auto tick"
                  value={autoTickLabel}
                  icon={Waves}
                />
                <StatusRow
                  label="Polling"
                  value={`${POLL_INTERVAL_MS / 1000}s cadence`}
                  icon={ArrowClockwise}
                />
              </div>

              <p className="mt-4 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {burnerStatus.error
                  ? `Burner note: ${burnerStatus.error}`
                  : burnerStatus.usingFallback
                    ? "Burner funding is unavailable, so auto tick is using your connected wallet for real ER transactions."
                  : `The burner requests ${(
                      AUTO_TICK_AIRDROP_LAMPORTS / 1_000_000_000
                    ).toFixed(2)} devnet SOL once, then spends that on authentic ER tick signatures.`}
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className={cn("panel-shell min-w-0", selectedPanel !== "open" && "panel-muted")}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[color:var(--color-muted-foreground)]">
                  Screen 1
                </p>
                <h2 className="mt-3 font-display text-[clamp(2rem,3vw,3rem)] tracking-[-0.05em]">
                  Open the stream
                </h2>
              </div>
              <PanelToggle
                selected={selectedPanel === "open"}
                onClick={() => setSelectedPanel("open")}
              >
                Compose
              </PanelToggle>
            </div>

            <div className="mt-8 grid gap-5">
              <Field
                label="Receiver wallet"
                helper="Real devnet public key"
              >
                <input
                  value={receiver}
                  onChange={(event) => setReceiver(event.target.value)}
                  className="field-input"
                  placeholder="Enter a devnet wallet address"
                />
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field
                  label="Rate (SOL / sec)"
                  helper={`${(lamportsToSol(rateLamports) * 3600).toFixed(3)} SOL / hour`}
                >
                  <input
                    value={rateInput}
                    onChange={(event) => setRateInput(event.target.value)}
                    className="field-input"
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Deposit (SOL)"
                  helper={`${formatDuration(previewDurationSeconds)} of runway`}
                >
                  <input
                    value={depositInput}
                    onChange={(event) => setDepositInput(event.target.value)}
                    className="field-input"
                    inputMode="decimal"
                  />
                </Field>
              </div>

              <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <InlineStat
                    label="Payout pace"
                    value={`${(lamportsToSol(rateLamports) * 3600).toFixed(2)} SOL/hr`}
                  />
                  <InlineStat
                    label="Projected length"
                    value={formatDuration(previewDurationSeconds)}
                  />
                  <InlineStat label="Flow" value="Open + delegate" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void startStream()}
                  disabled={busyAction === "open" || !connected}
                >
                  <Drop weight="fill" className="size-5" />
                  {busyAction === "open" ? "Opening..." : "Start dripping"}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => setSelectedPanel("active")}
                  disabled={!trackedStream}
                >
                  <RadioButton className="size-5" />
                  Resume tracked stream
                </Button>
              </div>
            </div>
          </section>

          <section className={cn("panel-shell min-w-0", selectedPanel !== "active" && "panel-muted")}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[color:var(--color-muted-foreground)]">
                  Screen 2
                </p>
                <h2 className="mt-3 font-display text-[clamp(2rem,3vw,3rem)] tracking-[-0.05em]">
                  Track the live state
                </h2>
              </div>
              <PanelToggle
                selected={selectedPanel === "active"}
                onClick={() => setSelectedPanel("active")}
              >
                Live
              </PanelToggle>
            </div>

            <div className="mt-8 grid gap-5">
              <div className="overflow-hidden rounded-[1.7rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
                <div className="stream-topline">
                  <span className="inline-flex items-center gap-2">
                    <Pulse
                      weight={streamData?.status === "active" ? "fill" : "regular"}
                      className={cn(
                        "size-3.5",
                        streamData?.status === "active" && "animate-pulse text-[color:var(--color-accent)]",
                      )}
                    />
                    {streamData?.status === "active"
                      ? "Stream active"
                      : trackedStream
                        ? "Polling current stream"
                        : "No stream selected"}
                  </span>
                  <span>{activeElapsed}</span>
                </div>

                <div className="grid gap-4 p-5 sm:p-6">
                  <LiveMeter
                    icon={ArrowDown}
                    tone="down"
                    label="Payer balance remaining"
                    value={activePayerDisplay}
                    detail={
                      streamData
                        ? shorten(streamData.payer)
                        : "Open a real stream to read this from chain"
                    }
                  />
                  <LiveMeter
                    icon={ArrowUpRight}
                    tone="up"
                    label="Receiver claimable"
                    value={activeReceiverDisplay}
                    detail={
                      streamData
                        ? `${lamportsToSol(streamData.rateLamportsPerSec).toFixed(4)} SOL/sec`
                        : "Claim reflects authentic on-chain claimable balance"
                    }
                  />

                  <div className="grid gap-3 sm:grid-cols-3">
                    <InlineStat
                      label="Delegation"
                      value={streamData?.delegated ? "MagicBlock" : "Not delegated"}
                    />
                    <InlineStat
                      label="Status"
                      value={streamData?.status ?? "Idle"}
                    />
                    <InlineStat
                      label="Last tick"
                      value={
                        streamData?.lastTick
                          ? new Date(streamData.lastTick * 1000).toLocaleTimeString()
                          : "Not ticked"
                      }
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => void tickStream("manual")}
                      disabled={!trackedStream || busyAction === "tick"}
                    >
                      <Lightning className="size-5" />
                      {busyAction === "tick" ? "Ticking..." : "Tick on ER"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void claimStream()}
                      disabled={
                        !trackedStream ||
                        busyAction === "claim" ||
                        !connected ||
                        !isReceiverWallet
                      }
                    >
                      <Receipt className="size-5" />
                      {busyAction === "claim" ? "Claiming..." : "Claim"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void refreshNow()}
                      disabled={!trackedStream || busyAction === "refresh"}
                    >
                      <ArrowClockwise className="size-5" />
                      Refresh
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void closeStream()}
                      disabled={!trackedStream || busyAction === "close" || !connected}
                    >
                      <Pause className="size-5" />
                      Close stream
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
                <div className="min-w-0 rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted-foreground)]">
                    Authenticity notes
                  </p>
                  <ul className="mt-4 grid gap-4 text-sm leading-7 text-[color:var(--color-muted-foreground)]">
                    <li className="flex items-start gap-3">
                      <Timer className="mt-1 size-4 text-[color:var(--color-accent)]" />
                      Every number above is pulled from the real program accounts on devnet.
                    </li>
                    <li className="flex items-start gap-3">
                      <Lightning className="mt-1 size-4 text-[color:var(--color-accent)]" />
                      The browser-side burner sends authentic ER ticks, so motion comes from real
                      transactions, not interpolated fake state.
                    </li>
                    <li className="flex items-start gap-3">
                      <Receipt className="mt-1 size-4 text-[color:var(--color-accent)]" />
                      Mid-stream claim now uses ER commit plus L1 settlement, so the stream can
                      keep running after payout.
                    </li>
                  </ul>
                </div>

                <div className="min-w-0 rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted-foreground)]">
                    Activity tape
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                    {statusMessage}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {closeSummary ? (
                      <div className="rounded-[1.2rem] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 py-4">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-muted-foreground)]">
                          Final settlement
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <InlineStat
                            label="Receiver earned"
                            value={formatSol(closeSummary.receiverEarnedLamports)}
                          />
                          <InlineStat
                            label="Payer refund"
                            value={formatSol(closeSummary.payerRefundLamports)}
                          />
                        </div>
                        <a
                          href={explorerUrl(closeSummary.closeSignature)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--color-accent)]"
                        >
                          View close on explorer
                          <ArrowSquareOut className="size-3.5" />
                        </a>
                      </div>
                    ) : null}
                    {activity.length === 0 ? (
                      <div className="min-w-0 rounded-[1.2rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                        Real transaction signatures will accumulate here once you open, delegate,
                        tick, and close a stream.
                      </div>
                    ) : (
                      activity.map((item) => (
                        <div
                          key={item.id}
                          className="min-w-0 overflow-hidden rounded-[1.2rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                            {item.label}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em]",
                                item.layer === "ER"
                                  ? "border-[color:rgba(52,119,85,0.18)] bg-[rgba(52,119,85,0.08)] text-[color:var(--color-positive)]"
                                  : item.layer === "L1"
                                    ? "border-[color:rgba(212,94,47,0.18)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]"
                                    : "border-[color:var(--color-border)] bg-[color:var(--color-panel)] text-[color:var(--color-muted-foreground)]",
                              )}
                            >
                              {item.layer === "ER" ? "MagicBlock ER" : item.layer === "L1" ? "Solana L1" : "Local"}
                            </span>
                            {item.signature ? (
                              <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-[color:var(--color-muted-foreground)]">
                                {shorten(item.signature)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-all text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                            {item.detail}
                          </p>
                          {item.href ? (
                            <a
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--color-accent)]"
                            >
                              View signature
                              <ArrowSquareOut className="size-3.5" />
                            </a>
                          ) : item.layer === "ER" && item.signature ? (
                            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                              ER signatures are valid MagicBlock transactions and usually will not appear in Solana Explorer.
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function BackgroundWash() {
  return (
    <>
      <div className="absolute inset-0 -z-20 bg-[var(--color-background)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(212,94,47,0.18),_transparent_30%),radial-gradient(circle_at_90%_20%,_rgba(140,122,88,0.16),_transparent_24%),linear-gradient(180deg,_rgba(255,255,255,0.5),_rgba(255,255,255,0))]" />
      <div className="grain-overlay absolute inset-0 -z-10 opacity-60" />
    </>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.35rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted-foreground)]">
          {label}
        </p>
        <Icon className="size-4 text-[color:var(--color-accent)]" />
      </div>
      <p className="mt-4 font-display text-3xl tracking-[-0.04em] text-[color:var(--color-foreground)]">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {detail}
      </p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
          <Icon className="size-4 text-[color:var(--color-accent)]" />
        </div>
        <span className="text-sm text-[color:var(--color-muted-foreground)]">{label}</span>
      </div>
      <span className="text-sm font-semibold text-[color:var(--color-foreground)]">{value}</span>
    </div>
  );
}

function PanelToggle({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition",
        selected
          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
          : "border-[color:var(--color-border)] bg-[color:var(--color-panel)] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-3">
      <div className="flex items-end justify-between gap-4">
        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted-foreground)]">
          {label}
        </span>
        <span className="text-sm text-[color:var(--color-muted-foreground)]">{helper}</span>
      </div>
      {children}
    </label>
  );
}

function LiveMeter({
  icon: Icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: React.ElementType;
  tone: "up" | "down";
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--color-muted-foreground)]">
            {label}
          </p>
          <p className="mt-3 font-display text-[clamp(2rem,5vw,3.8rem)] leading-none tracking-[-0.06em]">
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full border",
            tone === "up"
              ? "border-[color:rgba(52,119,85,0.16)] bg-[rgba(52,119,85,0.1)] text-[color:var(--color-positive)]"
              : "border-[color:rgba(212,94,47,0.16)] bg-[rgba(212,94,47,0.1)] text-[color:var(--color-accent)]",
          )}
        >
          <Icon className="size-7" weight="bold" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{detail}</p>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[color:var(--color-foreground)]">{value}</p>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function shorten(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }

  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainderSeconds.toString().padStart(2, "0")}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return `${hours}h ${remainderMinutes.toString().padStart(2, "0")}m`;
}

function generateBurnerWallet() {
  return new KeypairWallet(anchor.web3.Keypair.generate());
}
