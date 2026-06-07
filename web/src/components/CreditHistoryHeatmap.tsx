"use client";

/**
 * Vigente Protocol — Credit History Heat Map
 *
 * GitHub-contributions style grid over the last 180 days of on-chain
 * activity for a Stellar account. Each cell is one UTC day; colour
 * encodes volume (USD-equivalent), and the hue shifts from green
 * (ecosystem-weighted) toward amber (P2P-heavy) so a reviewer can read
 * the carousel-attacker signal at a glance.
 *
 * Powered by `daily_activity` on the OnchainFeatures payload — empty
 * days are reconstructed locally so the visual never has gaps.
 */

import { useMemo, useState } from "react";

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  volume_usd: number;
  tx_count: number;
  ecosystem_ratio: number; // 0..1
}

interface CreditHistoryHeatmapProps {
  /** Sorted ascending. Days outside the window are clipped. */
  activity: HeatmapDay[];
  /** Defaults to 180 (matches Horizon scoring window). */
  windowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** UTC midnight of the given ms timestamp, as YYYY-MM-DD. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Map a quantile bucket to a tailwind background class. */
function bucketClass(bucket: 0 | 1 | 2 | 3 | 4, ecosystemRatio: number): string {
  if (bucket === 0) return "bg-zinc-900/60 ring-1 ring-zinc-800";
  // p2p-leaning days lean amber so reviewers can spot wash-trading visually
  const p2pLean = ecosystemRatio < 0.4;
  if (p2pLean) {
    return [
      "",
      "bg-amber-900/60",
      "bg-amber-700/80",
      "bg-amber-500",
      "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.45)]",
    ][bucket]!;
  }
  return [
    "",
    "bg-emerald-900/70",
    "bg-emerald-700",
    "bg-emerald-500",
    "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.5)]",
  ][bucket]!;
}

/** Compute non-zero quantile cutoffs from the day volumes. */
function quantileCutoffs(volumes: number[]): [number, number, number, number] {
  const positive = volumes.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [0, 0, 0, 0];
  const pick = (q: number) =>
    positive[Math.min(positive.length - 1, Math.floor(positive.length * q))]!;
  return [pick(0.25), pick(0.5), pick(0.75), pick(0.95)];
}

function bucketFor(volume: number, cutoffs: [number, number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (volume <= 0) return 0;
  if (volume <= cutoffs[0]) return 1;
  if (volume <= cutoffs[1]) return 2;
  if (volume <= cutoffs[2]) return 3;
  return 4;
}

function formatUsd(n: number): string {
  if (n < 1) return "$0";
  if (n < 1000) return `$${n.toFixed(0)}`;
  if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

interface Cell {
  date: string;
  volume_usd: number;
  tx_count: number;
  ecosystem_ratio: number;
  weekday: number; // 0=Sun..6=Sat
}

export function CreditHistoryHeatmap({
  activity,
  windowDays = 180,
}: CreditHistoryHeatmapProps) {
  const [hovered, setHovered] = useState<Cell | null>(null);

  // Build a date→activity map for O(1) lookup while we walk the window
  // backwards from today. This guarantees the grid covers every day even
  // when the on-chain payload only sent the active ones.
  const byDate = useMemo(() => {
    const m = new Map<string, HeatmapDay>();
    for (const a of activity) m.set(a.date, a);
    return m;
  }, [activity]);

  // Build the cells from oldest → newest so column 0 = oldest week.
  // Anchor the latest column on the most recent Sunday to keep the grid
  // visually rectangular instead of zigzagging.
  const { weeks, summary } = useMemo(() => {
    const todayMs = Date.now();
    const today = new Date(todayMs);
    // Move forward to next Saturday (end of grid) for a clean right edge.
    const daysToSaturday = (6 - today.getUTCDay() + 7) % 7;
    const endMs = todayMs + daysToSaturday * DAY_MS;
    const startMs = endMs - (windowDays + 6) * DAY_MS;
    const cells: Cell[] = [];
    let totalVol = 0;
    let activeDays = 0;
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const date = isoDay(ms);
      const dayActivity = byDate.get(date);
      const c: Cell = {
        date,
        volume_usd: dayActivity?.volume_usd ?? 0,
        tx_count: dayActivity?.tx_count ?? 0,
        ecosystem_ratio: dayActivity?.ecosystem_ratio ?? 0,
        weekday: new Date(ms).getUTCDay(),
      };
      cells.push(c);
      if (c.volume_usd > 0) {
        totalVol += c.volume_usd;
        activeDays += 1;
      }
    }
    // Re-shape into weeks (columns); each week is exactly 7 cells.
    const wk: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) wk.push(cells.slice(i, i + 7));
    return {
      weeks: wk,
      summary: {
        totalVol,
        activeDays,
        totalDays: cells.length,
      },
    };
  }, [byDate, windowDays]);

  const cutoffs = useMemo(
    () => quantileCutoffs(weeks.flat().map((c) => c.volume_usd)),
    [weeks],
  );

  const monthLabels = useMemo(() => {
    // For each week column, label only when the month changes vs the
    // previous column's first cell.
    const labels: { idx: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((wk, i) => {
      const ref = wk[0];
      if (!ref) return;
      const m = new Date(ref.date + "T00:00:00Z").getUTCMonth();
      if (m !== lastMonth) {
        labels.push({
          idx: i,
          label: new Date(ref.date + "T00:00:00Z").toLocaleDateString("en", {
            month: "short",
            timeZone: "UTC",
          }),
        });
        lastMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  const isEmpty = summary.activeDays === 0;

  return (
    <div className="w-full rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-white tracking-tight">
            on-chain credit activity
          </h3>
          <p className="text-xs text-white/50 mt-0.5">
            last {windowDays} days · stellar testnet · UTC
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-medium tabular-nums">
            {formatUsd(summary.totalVol)}
          </div>
          <div className="text-[11px] text-white/50">
            {summary.activeDays}/{summary.totalDays} active days
          </div>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="text-3xl mb-2">○</div>
          <div className="text-white/70 text-sm">no on-chain activity yet</div>
          <div className="text-white/40 text-xs mt-1">
            once this wallet transacts, the grid lights up
          </div>
        </div>
      ) : (
        <>
          {/* Month strip */}
          <div className="relative h-4 ml-7 mb-1 text-[10px] text-white/40">
            {monthLabels.map((m) => (
              <span
                key={`${m.idx}-${m.label}`}
                className="absolute"
                style={{ left: `${m.idx * 14}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            {/* Weekday label column */}
            <div className="flex flex-col gap-[2px] text-[10px] text-white/40 pt-[1px]">
              {WEEKDAY_LABELS.map((d, i) => (
                <span
                  key={d}
                  className="h-3 leading-3"
                  style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}
                >
                  {d}
                </span>
              ))}
            </div>

            {/* Grid */}
            <div
              className="flex gap-[2px] overflow-x-auto pb-2"
              onMouseLeave={() => setHovered(null)}
            >
              {weeks.map((wk, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {Array.from({ length: 7 }).map((_, di) => {
                    const c = wk[di];
                    if (!c) {
                      return (
                        <div key={di} className="h-3 w-3" />
                      );
                    }
                    const b = bucketFor(c.volume_usd, cutoffs);
                    return (
                      <button
                        key={c.date}
                        type="button"
                        aria-label={`${c.date}: ${formatUsd(c.volume_usd)} across ${c.tx_count} tx`}
                        onMouseEnter={() => setHovered(c)}
                        onFocus={() => setHovered(c)}
                        className={`h-3 w-3 rounded-[2px] transition-transform hover:scale-150 focus:outline-none focus:ring-1 focus:ring-emerald-300 ${bucketClass(
                          b,
                          c.ecosystem_ratio,
                        )}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend + tooltip strip */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-white/50">
            <div className="flex items-center gap-2 min-h-[18px]">
              {hovered ? (
                <span className="text-white/80">
                  <span className="text-white">{hovered.date}</span>{" "}
                  · {formatUsd(hovered.volume_usd)} ·{" "}
                  {hovered.tx_count} tx ·{" "}
                  {Math.round(hovered.ecosystem_ratio * 100)}% ecosystem
                </span>
              ) : (
                <span>hover a cell to inspect</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span>less</span>
              <span className="h-3 w-3 rounded-[2px] bg-zinc-900/60 ring-1 ring-zinc-800" />
              <span className="h-3 w-3 rounded-[2px] bg-emerald-900/70" />
              <span className="h-3 w-3 rounded-[2px] bg-emerald-700" />
              <span className="h-3 w-3 rounded-[2px] bg-emerald-500" />
              <span className="h-3 w-3 rounded-[2px] bg-emerald-300" />
              <span>more</span>
              <span className="ml-3 inline-block h-3 w-3 rounded-[2px] bg-amber-500" />
              <span>= P2P-heavy</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
