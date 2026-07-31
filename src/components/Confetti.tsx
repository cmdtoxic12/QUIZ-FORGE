"use client";

import { useMemo } from "react";

const COLORS = ["#a78bfa", "#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#60a5fa"];

export default function Confetti({ pieces = 70 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        dx: `${(Math.random() - 0.5) * 240}px`,
        dur: `${2.2 + Math.random() * 2}s`,
        delay: `${Math.random() * 0.8}s`,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 8,
      })),
    [pieces],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {items.map((item) => (
        <span
          key={item.id}
          className="confetti-piece"
          style={{
            left: `${item.left}%`,
            background: item.color,
            width: item.w,
            animationDelay: item.delay,
            ["--dx" as string]: item.dx,
            ["--dur" as string]: item.dur,
          }}
        />
      ))}
    </div>
  );
}
