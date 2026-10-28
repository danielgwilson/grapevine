import { useEffect, useMemo, useRef, useState } from "react";

import type { Player } from "../engine/player";
import { DAY, HOUR } from "../engine/replay";
import { fmtCount, fmtMonth, fmtShort } from "./format";

const BAR_TOP = 26;
const BAR_H = 54;
const AXIS_Y = BAR_TOP + BAR_H + 6;
const HEIGHT = AXIS_Y + 16;

export function Timeline({ player, t }: { player: Player; t: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const scrubbing = useRef(false);
  const { dataset, hist, moments } = player;
  const span = dataset.end - dataset.start;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xOf = (time: number) => ((time - dataset.start) / span) * width;

  const bars = useMemo(() => {
    // Aggregate bins into columns at least 2px wide.
    const columns = Math.min(hist.counts.length, Math.floor(width / 2));
    const per = hist.counts.length / columns;
    const sums = new Float64Array(columns);
    for (let i = 0; i < hist.counts.length; i += 1)
      sums[Math.min(columns - 1, Math.floor(i / per))] += hist.counts[i];
    let max = 1;
    for (const s of sums) max = Math.max(max, s);
    const colW = width / columns;
    let d = "";
    for (let c = 0; c < columns; c += 1) {
      if (sums[c] === 0) continue;
      const h = Math.max(1.5, Math.sqrt(sums[c] / max) * BAR_H);
      d += `M${(c * colW).toFixed(1)} ${(BAR_TOP + BAR_H).toFixed(1)}h${Math.max(1, colW - 1).toFixed(1)}v${(-h).toFixed(1)}h${(-Math.max(1, colW - 1)).toFixed(1)}z`;
    }
    return d;
  }, [hist, width]);

  const ticks = useMemo(() => {
    const xOf = (time: number) => ((time - dataset.start) / span) * width;
    const out: { x: number; label: string; weekend: boolean; dayW: number }[] = [];
    const days = span / DAY;
    const dayW = width / days;
    if (days <= 120) {
      const every = dayW >= 38 ? 1 : dayW >= 12 ? 7 : 14;
      const d = new Date(dataset.start);
      for (let i = 0; d.getTime() < dataset.end; i += 1) {
        const dow = d.getDay();
        const labelled = every === 1 || (every === 7 ? dow === 1 : dow === 1 && i % 14 < 7);
        out.push({
          x: xOf(d.getTime()),
          label: labelled && xOf(d.getTime()) < width - 44 ? fmtShort(d.getTime()) : "",
          weekend: dow === 0 || dow === 6,
          dayW,
        });
        d.setDate(d.getDate() + 1);
      }
    } else {
      const d = new Date(dataset.start);
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const monthW = (30 * DAY * width) / span;
      const every = monthW >= 50 ? 1 : monthW >= 18 ? 3 : 12;
      for (let i = 0; d.getTime() < dataset.end; i += 1) {
        if (i % every === 0)
          out.push({ x: xOf(d.getTime()), label: fmtMonth(d.getTime()), weekend: false, dayW: 0 });
        d.setMonth(d.getMonth() + 1);
      }
    }
    return out;
  }, [dataset, width, span]);

  const timeAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return dataset.start;
    return dataset.start + ((clientX - rect.left) / rect.width) * span;
  };

  const playX = xOf(t);
  // A moment gets a text label only if it fits before the next marker.
  const momentXs = moments.map((m) => xOf(m.t + (m.end - m.t) / 2));

  return (
    <div
      ref={ref}
      className="timeline"
      role="slider"
      tabIndex={-1}
      aria-label="Playback position"
      aria-valuemin={dataset.start}
      aria-valuemax={dataset.end}
      aria-valuenow={Math.round(t)}
      onPointerDown={(e) => {
        if ((e.target as Element).closest(".moment")) return;
        scrubbing.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        player.seek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (scrubbing.current) player.seek(timeAt(e.clientX));
      }}
      onPointerUp={() => {
        scrubbing.current = false;
      }}
    >
      <svg width={width} height={HEIGHT} role="img" aria-label="Messages per hour">
        <defs>
          <clipPath id="played">
            <rect x={0} y={0} width={Math.max(0, playX)} height={HEIGHT} />
          </clipPath>
        </defs>
        {ticks.map((tick) =>
          tick.weekend ? (
            <rect
              key={`w${tick.x}`}
              x={tick.x}
              y={BAR_TOP}
              width={tick.dayW}
              height={BAR_H}
              className="weekend"
            />
          ) : null,
        )}
        <path d={bars} className="bars" />
        <path d={bars} className="bars played" clipPath="url(#played)" />
        <line
          x1={0}
          x2={width}
          y1={BAR_TOP + BAR_H + 0.5}
          y2={BAR_TOP + BAR_H + 0.5}
          className="baseline"
        />
        {ticks.map((tick) =>
          tick.label ? (
            <g key={`t${tick.x}`}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={BAR_TOP + BAR_H}
                y2={BAR_TOP + BAR_H + 4}
                className="tick"
              />
              <text x={tick.x + 3} y={AXIS_Y + 9} className="axis">
                {tick.label}
              </text>
            </g>
          ) : null,
        )}
        {moments.map((m, i) => {
          const x = momentXs[i];
          const text = `${m.label} · ${fmtCount(m.count)}`;
          const next = momentXs[i + 1] ?? width + 400;
          const showText = next - x > text.length * 6.6 + 18 && x + text.length * 6.6 + 10 < width;
          return (
            <g
              key={m.t}
              className="moment"
              onClick={() => {
                player.seek(m.t - 2 * HOUR);
                player.setSpeed(0);
                player.play();
              }}
            >
              <title>{`Jump to ${text} messages in 3 hours`}</title>
              <line x1={x} x2={x} y1={14} y2={BAR_TOP + BAR_H} />
              <circle cx={x} cy={12} r={3.5} />
              {showText ? (
                <text x={x + 8} y={15}>
                  {text}
                </text>
              ) : null}
              <rect
                x={x - 8}
                y={0}
                width={showText ? text.length * 6.6 + 18 : 16}
                height={24}
                className="hit"
              />
            </g>
          );
        })}
        <line x1={playX} x2={playX} y1={4} y2={BAR_TOP + BAR_H + 4} className="playhead" />
        <circle cx={playX} cy={BAR_TOP + BAR_H + 4} r={3} className="playhead-dot" />
      </svg>
    </div>
  );
}
