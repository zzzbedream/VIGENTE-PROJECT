/**
 * Dynamic OG image for Vigente Protocol — 1200×630.
 * Renders the brand mark + headline + three honest stats. No external assets.
 */
import { ImageResponse } from "next/og";

export const alt = "Vigente Protocol — credit without permission";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#050505",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          fontFamily: "system-ui, sans-serif",
          color: "#fff",
        }}
      >
        {/* Top: logo + brand name */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <polyline
              points="4 13 10 19 20 6"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={{ fontSize: 36, fontWeight: 500, letterSpacing: -1 }}>
            vigente
          </span>
        </div>

        {/* Middle: tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 900,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 500,
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            credit without permission
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 300,
              color: "rgba(255,255,255,0.75)",
              maxWidth: 800,
              lineHeight: 1.3,
            }}
          >
            k-of-n threshold credit oracle on Stellar Soroban. Verifiable
            borrower reputation signed by an independent quorum, with zero
            fintech in the trust path.
          </div>
        </div>

        {/* Bottom: honest stats */}
        <div style={{ display: "flex", gap: 64, alignItems: "flex-end" }}>
          <Stat number="3 of 5" label="ed25519 threshold sigs" />
          <Stat number="104" label="tests green" />
          <Stat number="92 b" label="canonical mint message" />
          <div
            style={{
              marginLeft: "auto",
              fontSize: 18,
              color: "rgba(255,255,255,0.55)",
              alignSelf: "flex-end",
            }}
          >
            live on stellar testnet
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 56, fontWeight: 500, letterSpacing: -2 }}>
        {number}
      </span>
      <span style={{ fontSize: 18, color: "rgba(255,255,255,0.7)" }}>
        {label}
      </span>
    </div>
  );
}
