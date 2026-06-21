/**
 * Vigente Protocol — logo mark (shield + verified check).
 *
 * Sober, institutional. Indigo/violet shield with a gold verification check —
 * the corporate palette toned down for a B2B audience (no neon). Used in the
 * landing nav and the app headers.
 */

export function VigenteLogo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      role="img"
    >
      <path
        d="M16 3 L27 7 V15.2 C27 22 22.2 27 16 29 C9.8 27 5 22 5 15.2 V7 Z"
        stroke="url(#vigente-shield)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="rgba(129,140,248,0.07)"
      />
      <path
        d="M11 16.2 l3.3 3.4 L21.6 12"
        stroke="#fbbf24"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient
          id="vigente-shield"
          x1="5"
          y1="3"
          x2="27"
          y2="29"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#818cf8" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Logo mark + wordmark, for nav/header use. */
export function VigenteWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <VigenteLogo className="h-7 w-7" />
      <span className="text-[15px] font-semibold tracking-tight text-slate-100">
        Vigente <span className="text-slate-400 font-normal">Protocol</span>
      </span>
    </span>
  );
}
