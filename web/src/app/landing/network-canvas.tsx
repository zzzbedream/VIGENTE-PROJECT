"use client";

/**
 * Ambient "reputation network" animation: drifting nodes, proximity links and
 * occasional pulses travelling between neighbors. Pure canvas — no deps.
 * Honors prefers-reduced-motion by drawing a single static frame.
 */

import { useEffect, useRef } from "react";

const ACCENT = "139,233,176"; // #8BE9B0
const PULSE = "165,240,194"; // #A5F0C2

interface NetworkCanvasProps {
  /** node count */
  count: number;
  /** global opacity multiplier for links/nodes */
  alpha: number;
  /** max link distance in CSS px */
  dist: number;
  className?: string;
}

interface NetNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Pulse {
  a: number;
  b: number;
  p: number;
}

export function NetworkCanvas({ count, alpha, dist, className }: NetworkCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;

    const nodes: NetNode[] = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
      r: 1.2 + Math.random() * 2.2,
    }));
    const pulses: Pulse[] = [];
    const maxD = dist * dpr;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = canvas.width = Math.max(1, Math.round(rect.width * dpr));
      h = canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
      }
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = (a.x - b.x) * w;
          const dy = (a.y - b.y) * h;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < maxD) {
            const o = (1 - d / maxD) * 0.28 * alpha;
            ctx.strokeStyle = `rgba(${ACCENT},${o.toFixed(3)})`;
            ctx.lineWidth = dpr * 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = `rgba(${ACCENT},${(0.5 * alpha).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, n.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const spawnPulse = () => {
      if (Math.random() >= 0.05 || pulses.length >= 6) return;
      const i = Math.floor(Math.random() * count);
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const dx = (nodes[i].x - nodes[j].x) * w;
        const dy = (nodes[i].y - nodes[j].y) * h;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best >= 0 && Math.sqrt(bd) < maxD * 1.4) pulses.push({ a: i, b: best, p: 0 });
    };

    const drawPulses = () => {
      for (let k = pulses.length - 1; k >= 0; k--) {
        const pu = pulses[k];
        pu.p += 0.016;
        if (pu.p >= 1) {
          pulses.splice(k, 1);
          continue;
        }
        const a = nodes[pu.a];
        const b = nodes[pu.b];
        const x = (a.x + (b.x - a.x) * pu.p) * w;
        const y = (a.y + (b.y - a.y) * pu.p) * h;
        ctx.fillStyle = `rgba(${PULSE},${(0.9 * Math.sin(pu.p * Math.PI)).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduced) {
      drawFrame();
    } else {
      const tick = () => {
        drawFrame();
        spawnPulse();
        drawPulses();
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count, alpha, dist]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
