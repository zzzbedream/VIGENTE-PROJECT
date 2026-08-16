import type { NextConfig } from "next";

/**
 * Vigente Protocol — Next.js config with security headers (Phase G.5)
 *
 * CSP allowlists every external origin the app actually talks to. The
 * Stellar Wallets Kit lazily loads xBull/Albedo/Freighter from their
 * own origins, so frame-src and connect-src include those.
 *
 * Honest TODO on `'unsafe-inline'` in script-src: Next.js + React Compiler
 * still emit inline hydration scripts and Next.js does not yet expose a
 * stable nonce hook for the App Router runtime. The CSP keeps every other
 * directive tight (frame-ancestors none, object-src none, base-uri self)
 * so XSS via inline injection still gets blocked by the surrounding
 * scaffolding. Documented in docs/THREAT_MODEL.md under "future hardening".
 */

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://vigente-hackathon-final.vercel.app"
).replace(/\/$/, "");

const STELLAR_RPC_HOSTS = [
  "https://horizon-testnet.stellar.org",
  "https://soroban-testnet.stellar.org",
  "https://friendbot.stellar.org",
  "https://stellar.expert",
  "https://api.stellar.expert",
  // Wallet Kit / WalletConnect signaling
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
];

const CSP = [
  "default-src 'self'",
  // unsafe-inline / unsafe-eval kept until Next.js nonce hook lands (see header).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // stellar.creit.tech and onekey-asset.com serve the wallet icons used by
  // the Stellar Wallets Kit modal (xbull, albedo, freighter, rabet, lobstr,
  // hana, klever, bitget, fordefi, cactuslink, onekey). Adding them here
  // keeps the modal pretty without dropping CSP on the floor.
  "img-src 'self' data: blob: https://stellar.expert https://*.walletconnect.com https://stellar.creit.tech https://uni.onekey-asset.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' ${SITE_URL} ${STELLAR_RPC_HOSTS.join(" ")}`,
  // Wallet kit popups / iframes
  "frame-src 'self' https://*.xbull.app https://albedo.link https://*.walletconnect.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// Worker and Turbopack-memory caps exist to work around a LOCAL constraint: the
// dev machine reports 23 logical CPUs, and the defaults (one worker each, plus an
// unbounded Turbopack cache) exhaust Windows commit memory during `next build`.
//
// They must NOT apply on CI. Vercel builds on 2 cores, where forcing 4 workers
// oversubscribes and a 1.5 GB Turbopack cap starves the compiler — which surfaces
// as intermittent "Can't resolve '@vercel/turbopack-next/internal/font/google/font'"
// failures while resolving next/font. Let the platform pick its own defaults.
const isCI = Boolean(process.env.VERCEL || process.env.CI);

const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(isCI ? {} : { experimental: { cpus: 4, turbopackMemoryLimit: 1_610_612_736 } }),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
