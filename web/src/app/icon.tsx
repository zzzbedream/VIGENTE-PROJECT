/**
 * Dynamic favicon for Vigente Protocol.
 * Next.js renders this as /icon at build / first request, no static .ico needed.
 * The mark is the green check from the logo on the app's near-black background.
 */
import { ImageResponse } from "next/og";

// See opengraph-image.tsx for the rationale. Same Windows-only Satori
// crash; same dynamic escape.
export const dynamic = "force-dynamic";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#050505",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#22c55e"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 13 10 19 20 6" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
