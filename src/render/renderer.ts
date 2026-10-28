import { MENTION, withAlpha } from "../engine/palette";
import type { Flight, Player } from "../engine/player";
import type { GraphNode } from "../engine/replay";

export type View = { k: number; x: number; y: number; width: number; height: number; dpr: number };

const BG = "#0d0e11";
const INK = "#edeef0"; // slate 12 (dark)
const MUTED = "#b0b4ba"; // slate 11 (dark)
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk Variable", system-ui, sans-serif';

const PULSE_MS = 900;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const initialsOf = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

export class Renderer {
  private refChannel = 1;
  private refPerson = 1;
  private initials = new Map<string, string>();

  constructor(private player: Player) {
    for (const p of player.dataset.people) this.initials.set(p.id, initialsOf(p.fullName));
  }

  /** Bounds-fitting transform for the visible graph. */
  fit(view: View): { k: number; x: number; y: number } | undefined {
    const nodes = this.player.layout.visible;
    if (nodes.length === 0) return undefined;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      const r = (n.r ?? 6) + 18;
      x0 = Math.min(x0, (n.x ?? 0) - r);
      y0 = Math.min(y0, (n.y ?? 0) - r);
      x1 = Math.max(x1, (n.x ?? 0) + r);
      y1 = Math.max(y1, (n.y ?? 0) + r);
    }
    // Keep clear of the HUD (top left) and the legend (bottom).
    const top = view.height > 420 ? 128 : 96;
    const bottom = 44;
    const side = 40;
    const availW = view.width - side * 2;
    const availH = view.height - top - bottom;
    const k = Math.max(0.12, Math.min(1.8, availW / (x1 - x0), availH / (y1 - y0)));
    return {
      k,
      x: side + availW / 2 - ((x0 + x1) / 2) * k,
      y: top + availH / 2 - ((y0 + y1) / 2) * k,
    };
  }

  pick(view: View, sx: number, sy: number): GraphNode | undefined {
    const wx = (sx - view.x) / view.k;
    const wy = (sy - view.y) / view.k;
    let best: GraphNode | undefined;
    let bestD = Infinity;
    for (const n of this.player.layout.visible) {
      const d = Math.hypot((n.x ?? 0) - wx, (n.y ?? 0) - wy);
      const reach = (n.r ?? 5) + 6 / view.k;
      // People sit on top of channels, so prefer them on ties.
      const score = d - reach + (n.kind === "channel" ? 2 / view.k : 0);
      if (d <= reach && score < bestD) {
        bestD = score;
        best = n;
      }
    }
    return best;
  }

  draw(ctx: CanvasRenderingContext2D, view: View, now: number) {
    const { player } = this;
    const { replay, layout } = player;
    const { k } = view;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, view.width, view.height);
    const glow = ctx.createRadialGradient(
      view.width * 0.45,
      view.height * 0.4,
      0,
      view.width * 0.45,
      view.height * 0.4,
      Math.max(view.width, view.height) * 0.75,
    );
    glow.addColorStop(0, "rgba(59, 158, 255, 0.07)");
    glow.addColorStop(1, "rgba(59, 158, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, view.width, view.height);
    this.drawGrid(ctx, view);

    ctx.setTransform(view.dpr * k, 0, 0, view.dpr * k, view.dpr * view.x, view.dpr * view.y);

    // Scale references ease toward the current maxima so sizes do not jump.
    let maxC = 0;
    let maxP = 0;
    for (const n of layout.visible) {
      const a = replay.activity(n);
      if (n.kind === "channel") maxC = Math.max(maxC, a);
      else maxP = Math.max(maxP, a);
    }
    this.refChannel += (Math.max(maxC, 1) - this.refChannel) * 0.05;
    this.refPerson += (Math.max(maxP, 1) - this.refPerson) * 0.05;

    for (const n of layout.visible) {
      const norm = clamp01(
        replay.activity(n) / (n.kind === "channel" ? this.refChannel : this.refPerson),
      );
      const target = n.kind === "channel" ? 8 + 28 * Math.sqrt(norm) : 3 + 9 * Math.sqrt(norm);
      n.r = n.r === undefined ? target : n.r + (target - n.r) * 0.14;
    }

    const focusNode = player.focusKey ? replay.nodes.get(player.focusKey) : undefined;
    const focusKey = focusNode && focusNode.bornAt <= replay.t ? focusNode.key : undefined;
    let near: Set<string> | undefined;
    if (focusKey) {
      near = new Set([focusKey]);
      for (const e of replay.edges.values()) {
        if (e.source.key === focusKey) near.add(e.target.key);
        else if (e.target.key === focusKey) near.add(e.source.key);
      }
    }

    // Edges.
    ctx.lineCap = "round";
    for (const link of layout.links) {
      const { source: s, target: t, edge, norm } = link;
      const touched = near ? edge.source.key === focusKey || edge.target.key === focusKey : true;
      let alpha = edge.kind === "post" ? 0.05 + 0.4 * norm : 0.04 + 0.3 * norm;
      if (near) alpha = touched ? Math.max(alpha, 0.35) + 0.25 : alpha * 0.15;
      if (alpha < 0.012) continue;
      ctx.strokeStyle = withAlpha(edge.kind === "post" ? s.color : MENTION, alpha);
      ctx.lineWidth = (edge.kind === "post" ? 0.6 + 2.2 * norm : 0.5 + 1.4 * norm) / Math.sqrt(k);
      ctx.beginPath();
      ctx.moveTo(s.x ?? 0, s.y ?? 0);
      if (edge.kind === "mention") {
        const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2 - ((t.y ?? 0) - (s.y ?? 0)) * 0.18;
        const my = ((s.y ?? 0) + (t.y ?? 0)) / 2 + ((t.x ?? 0) - (s.x ?? 0)) * 0.18;
        ctx.quadraticCurveTo(mx, my, t.x ?? 0, t.y ?? 0);
      } else {
        ctx.lineTo(t.x ?? 0, t.y ?? 0);
      }
      ctx.stroke();
    }

    // Channels underneath people.
    const channels = layout.visible.filter((n) => n.kind === "channel");
    const people = layout.visible.filter((n) => n.kind === "person");
    const loudChannels = new Set(
      [...channels]
        .sort((a, b) => replay.activity(b) - replay.activity(a))
        .slice(0, 9)
        .map((n) => n.key),
    );

    for (const n of channels) {
      const dim = near && !near.has(n.key);
      const r = n.r ?? 8;
      const fresh = clamp01(replay.activity(n) / this.refChannel);
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = withAlpha(n.color, 0.06 + 0.14 * fresh);
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(n.color, 0.35 + 0.6 * fresh);
      ctx.lineWidth = (n.key === focusKey ? 2.4 : 1.4) / k;
      ctx.stroke();
    }

    // Pulses and flights glow additively.
    ctx.globalCompositeOperation = "lighter";
    for (const n of layout.visible) {
      const age = now - n.pulseAt;
      if (age < 0 || age > PULSE_MS || (near && !near.has(n.key))) continue;
      const p = age / PULSE_MS;
      ctx.beginPath();
      if (n.kind === "channel") {
        // Channels ripple outward.
        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1.4 / k;
        ctx.arc(n.x ?? 0, n.y ?? 0, (n.r ?? 8) + 4 + p * 22, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // People glow, so they never read as rings (rings mean channels).
        ctx.globalAlpha = (1 - p) * 0.28;
        ctx.fillStyle = n.color;
        ctx.arc(n.x ?? 0, n.y ?? 0, (n.r ?? 3) * (1.6 + p * 0.9) + 2 / k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of player.flights) this.drawFlight(ctx, f, now, k, near);
    ctx.globalCompositeOperation = "source-over";

    for (const n of people) {
      const dim = near && !near.has(n.key);
      const r = n.r ?? 3;
      const fresh = clamp01(replay.activity(n) / this.refPerson);
      const flash = clamp01(1 - (now - n.pulseAt) / 500);
      ctx.globalAlpha = dim ? 0.14 : 0.42 + 0.58 * Math.max(fresh, 0.15);
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      ctx.fill();
      if (flash > 0 && !dim) {
        ctx.globalAlpha = flash * 0.85;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      if (n.key === focusKey) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6 / k;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, r + 3 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (r * k >= 9 && !dim) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = BG;
        ctx.font = `600 ${Math.round(r * 0.82 * k)}px ${DISPLAY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.save();
        ctx.translate(n.x ?? 0, n.y ?? 0);
        ctx.scale(1 / k, 1 / k);
        ctx.fillText(this.initials.get(n.id) ?? "", 0, 1);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // Labels in screen space so they stay crisp at any zoom.
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `500 11px ${MONO}`;
    // Greedy placement by priority: focus first, then the loudest nodes.
    // Each label tries below its node, then above; it is skipped if both collide.
    const candidates = layout.visible
      .filter((n) =>
        near
          ? near.has(n.key)
          : n.kind === "channel" && (loudChannels.has(n.key) || (n.r ?? 0) * k > 16),
      )
      .sort(
        (a, b) =>
          Number(b.key === focusKey) - Number(a.key === focusKey) ||
          Number(b.kind === "channel") - Number(a.kind === "channel") ||
          replay.activity(b) - replay.activity(a),
      );
    const placed: Array<[number, number, number, number]> = [];
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      placed.every(([a0, b0, a1, b1]) => x1 < a0 || x0 > a1 || y1 < b0 || y0 > b1);
    for (const n of candidates) {
      const w = ctx.measureText(n.label).width + 8;
      const h = 16;
      const sx = (n.x ?? 0) * k + view.x;
      const r = (n.r ?? 4) * k;
      const sy = (n.y ?? 0) * k + view.y;
      const slots = [sy + r + 5, sy - r - 5 - h];
      const slot = slots.find((y) => free(sx - w / 2, y, sx + w / 2, y + h));
      const y = slot ?? (n.key === focusKey ? slots[0] : undefined);
      if (y === undefined) continue;
      placed.push([sx - w / 2, y, sx + w / 2, y + h]);
      ctx.fillStyle = "rgba(13, 14, 17, 0.78)";
      ctx.fillRect(sx - w / 2, y, w, h);
      ctx.fillStyle = n.key === focusKey ? INK : n.kind === "channel" ? MUTED : n.color;
      ctx.fillText(n.label, sx, y + 2);
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, view: View) {
    let step = 48;
    while (step * view.k < 22) step *= 2;
    const s = step * view.k;
    const ox = ((view.x % s) + s) % s;
    const oy = ((view.y % s) + s) % s;
    ctx.fillStyle = "rgba(237, 238, 240, 0.055)";
    for (let x = ox; x < view.width; x += s) {
      for (let y = oy; y < view.height; y += s) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }

  private drawFlight(
    ctx: CanvasRenderingContext2D,
    f: Flight,
    now: number,
    k: number,
    near?: Set<string>,
  ) {
    const raw = (now - f.start) / f.duration;
    if (raw <= 0 || raw >= 1) return;
    if (near && !near.has(f.from.key) && !near.has(f.to.key)) return;
    const x0 = f.from.x ?? 0;
    const y0 = f.from.y ?? 0;
    const x2 = f.to.x ?? 0;
    const y2 = f.to.y ?? 0;
    const cx = (x0 + x2) / 2 - (y2 - y0) * f.bend;
    const cy = (y0 + y2) / 2 + (x2 - x0) * f.bend;
    const at = (u: number) => {
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      return [a * x0 + b * cx + c * x2, a * y0 + b * cy + c * y2] as const;
    };
    const head = easeInOut(raw);
    const tail = Math.max(0, head - 0.22);
    const fade = raw > 0.85 ? (1 - raw) / 0.15 : 1;
    const steps = 7;
    ctx.lineCap = "round";
    for (let i = 0; i < steps; i += 1) {
      const u0 = tail + ((head - tail) * i) / steps;
      const u1 = tail + ((head - tail) * (i + 1)) / steps;
      const [ax, ay] = at(u0);
      const [bx, by] = at(u1);
      ctx.globalAlpha = ((i + 1) / steps) * 0.55 * fade;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = ((f.kind === "mention" ? 1.2 : 1.6) * (0.4 + (0.6 * (i + 1)) / steps)) / k;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    const [hx, hy] = at(head);
    ctx.globalAlpha = 0.95 * fade;
    ctx.fillStyle = f.kind === "mention" ? MENTION : "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, hy, (f.kind === "mention" ? 1.8 : 2.1) / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(hx, hy, 5 / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
