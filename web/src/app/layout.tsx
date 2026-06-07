import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Readex_Pro } from "next/font/google";
import "./globals.css";
import { WalletKitProvider } from "@/contexts/WalletKitContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const readexPro = Readex_Pro({
  variable: "--font-readex-pro",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://vigente-hackathon-final.vercel.app";

export const viewport: Viewport = {
  themeColor: "#050505",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Vigente Protocol — credit without permission",
    template: "%s · Vigente Protocol",
  },
  description:
    "k-of-n threshold credit oracle on Stellar Soroban. Verifiable borrower reputation signed by an independent quorum, with zero fintech in the trust path.",
  keywords: [
    "Stellar",
    "Soroban",
    "credit scoring",
    "threshold oracle",
    "ed25519",
    "Vigente",
    "on-chain reputation",
    "soulbound token",
  ],
  authors: [{ name: "Vigente Protocol" }],
  openGraph: {
    type: "website",
    siteName: "Vigente Protocol",
    title: "Vigente Protocol — credit without permission",
    description:
      "Threshold-signed credit badges on Stellar Soroban. 3-of-5 ed25519 quorum, no fintech dependency. 104 tests green, live on testnet.",
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vigente Protocol — credit without permission",
    description:
      "k-of-n threshold credit oracle on Stellar Soroban. No fintech in the trust path.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${readexPro.variable} antialiased`}
      >
        <WalletKitProvider>
          {children}
        </WalletKitProvider>
      </body>
    </html>
  );
}
