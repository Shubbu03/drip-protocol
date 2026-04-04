import type { Metadata } from "next";
import { SolanaProvider } from "@/components/providers/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drip",
  description: "Real-time SOL streaming payments, shaped for a smooth hackathon demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
