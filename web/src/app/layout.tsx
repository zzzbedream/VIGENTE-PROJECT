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
  // El respaldo debe ser un dominio presentable: si NEXT_PUBLIC_SITE_URL no
  // esta puesta en el entorno, este valor termina en cada etiqueta OG y en la
  // URL canonica. Antes decia "vigente-hackathon-final.vercel.app".
  process.env.NEXT_PUBLIC_SITE_URL || "https://vigenteprotocol.tech";

export const viewport: Viewport = {
  themeColor: "#050505",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Vigente Protocol — credit infrastructure for tokenized assets on Stellar",
    template: "%s · Vigente Protocol",
  },
  description:
    "Credit infrastructure on Stellar Soroban: holders of tokenized T-bills and stablecoins borrow against them instead of selling. Each borrower's limit comes from their on-chain repayment history. Built for platforms and payment operators. Testnet only.",
  keywords: [
    "Stellar",
    "Soroban",
    "collateralized lending",
    "credit reputation",
    "threshold oracle",
    "stablecoin credit",
    "Vigente",
    "on-chain reputation",
    "RWA collateral",
  ],
  authors: [{ name: "Vigente Protocol" }],
  // Declarados explicitamente en vez de confiar solo en la convencion de
  // archivos. Son estaticos a proposito: antes esto lo servia un icon.tsx con
  // `force-dynamic` que renderizaba una imagen en cada request, y si ese render
  // fallaba no habia icono. Un archivo no puede fallar.
  // El .ico lleva arte distinta por tamano (16/32/48): a 16px el escudo
  // completo se vuelve ruido, asi que ese tamano usa un recorte mas cerrado
  // donde el check sigue siendo legible.
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Vigente Protocol",
    title: "Vigente Protocol — credit infrastructure for tokenized assets on Stellar",
    description:
      "Borrow against tokenized T-bills and stablecoins instead of selling them. Each borrower's limit comes from their on-chain repayment history. Built for platforms and payment operators. Live on testnet; no external audit yet.",
    url: SITE_URL,
    // Alineado con <html lang>: la landing abre en ingles. Antes decia es_419
    // mientras el documento declaraba `en`.
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vigenteprotocol",
    creator: "@vigenteprotocol",
    title: "Vigente Protocol — credit infrastructure for tokenized assets on Stellar",
    description:
      "Borrow against tokenized T-bills and stablecoins instead of selling them. Limits come from on-chain repayment history. Live on Stellar testnet; no external audit yet.",
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
