import { MENTION, withAlpha } from "../engine/palette";
import type { Flight, Player } from "../engine/player";
import type { GraphNode } from "../engine/replay";

export type View = { k: number; x: number; y: number; width: number; height: number; dpr: number };

const VOID = "#05070b";
const INK = "#eef3ff";
const INK_2 = "#aab4c8";
const MONO = '"Martian Mono Variable", ui-monospace, monospace';
const SANS = '"Geist Variable", system-ui, sans-serif';

const PULSE_MS = 900;
const AVATAR_PX = 128;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const initialsOf = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

/** A soft radial glow, pre-rendered once per color and drawn with additive blending. */
const glowCache = new Map<string, HTMLCanvasElement>();
const glowSprite = (color: string) => {
  let sprite = glowCache.get(color);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const g = sprite.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, withAlpha(color, 0.9));
    grad.addColorStop(0.25, withAlpha(color, 0.35));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  glowCache.set(color, sprite);
  return sprite;
};

/** The background field, rendered once per size with noise dithering so the gradient does not band. */
const fieldCache: { key: string; canvas?: HTMLCanvasElement } = { key: "" };
const fieldCanvas = (w: number, h: number) => {
  const key = `${w}x${h}`;
  if (fieldCache.key === key && fieldCache.canvas) return fieldCache.canvas;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(
      w * 0.5,
      h * 0.55,
      0,
      w * 0.5,
      h * 0.55,
      Math.max(w, h) * 0.7,
    );
    grad.addColorStop(0, "#0d1322");
    grad.addColorStop(1, VOID);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 3;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }
  fieldCache.key = key;
  fieldCache.canvas = c;
  return c;
};

export class Renderer {
  private refChannel = 1;
  private refPerson = 1;
  private initials = new Map<string, string>();
  /** Circular, pre-cropped avatars keyed by person id. */
  private avatars = new Map<string, HTMLCanvasElement>();

  constructor(private player: Player) {
    for (const p of player.dataset.people) {
      this.initials.set(p.id, initialsOf(p.fullName));
      if (p.avatar) this.loadAvatar(p.id, p.avatar);
    }
  }

  private loadAvatar(id: string, url: string) {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = AVATAR_PX;
      const g = c.getContext("2d");
      if (!g) return;
      g.beginPath();
      g.arc(AVATAR_PX / 2, AVATAR_PX / 2, AVATAR_PX / 2, 0, Math.PI * 2);
      g.clip();
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(
        img,
        (img.naturalWidth - s) / 2,
        (img.naturalHeight - s) / 2,
        s,
        s,
        0,
        0,
        AVATAR_PX,
        AVATAR_PX,
      );
      this.avatars.set(id, c);
    };
    // A missing photo just falls back to a lit point.
    img.onerror = () => undefined;
    img.src = url;
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
    const top = view.height > 420 ? 132 : 96;
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

    // Field.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(
      fieldCanvas(Math.round(view.width * view.dpr), Math.round(view.height * view.dpr)),
      0,
      0,
    );

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
      const target =
        n.kind === "channel"
          ? 10 + 26 * Math.sqrt(norm)
          : this.avatars.has(n.id)
            ? 6 + 9 * Math.sqrt(norm)
            : 2.5 + 6 * Math.sqrt(norm);
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

    const channels = layout.visible.filter((n) => n.kind === "channel");
    const people = layout.visible.filter((n) => n.kind === "person");

    // Edges and glows add light, so overlaps brighten instead of muddying.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const link of layout.links) {
      const { source: s, target: t, edge, norm } = link;
      const touched = near ? edge.source.key === focusKey || edge.target.key === focusKey : true;
      let alpha = edge.kind === "post" ? 0.035 + 0.28 * norm : 0.03 + 0.22 * norm;
      if (near) alpha = touched ? Math.max(alpha, 0.3) + 0.2 : alpha * 0.12;
      if (alpha < 0.01) continue;
      ctx.strokeStyle = withAlpha(edge.kind === "post" ? s.color : MENTION, alpha);
      ctx.lineWidth = (edge.kind === "post" ? 0.5 + 1.6 * norm : 0.5 + 1.1 * norm) / Math.sqrt(k);
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

    // Channel halos, then hairline rings.
    for (const n of channels) {
      const dim = near && !near.has(n.key);
      const r = n.r ?? 10;
      const fresh = clamp01(replay.activity(n) / this.refChannel);
      const flash = clamp01(1 - (now - n.pulseAt) / 600);
      ctx.globalAlpha = (dim ? 0.08 : 0.18 + 0.35 * fresh) + flash * 0.15;
      ctx.drawImage(
        glowSprite(n.color),
        (n.x ?? 0) - r * 1.25,
        (n.y ?? 0) - r * 1.25,
        r * 2.5,
        r * 2.5,
      );
    }
    ctx.globalCompositeOperation = "source-over";
    for (const n of channels) {
      const dim = near && !near.has(n.key);
      const r = n.r ?? 10;
      const fresh = clamp01(replay.activity(n) / this.refChannel);
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.strokeStyle = withAlpha(n.color, 0.3 + 0.6 * fresh);
      ctx.lineWidth = (n.key === focusKey ? 1.8 : 1) / k;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // A small bright core marks the channel's center of gravity.
      ctx.fillStyle = withAlpha(n.color, 0.5 + 0.5 * fresh);
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, 1.6 / Math.sqrt(k), 0, Math.PI * 2);
      ctx.fill();
    }

    // Ripples, person glows and flights.
    ctx.globalCompositeOperation = "lighter";
    for (const n of layout.visible) {
      const age = now - n.pulseAt;
      if (age < 0 || age > PULSE_MS || (near && !near.has(n.key))) continue;
      const p = age / PULSE_MS;
      if (n.kind === "channel") {
        ctx.globalAlpha = (1 - p) * 0.5;
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, (n.r ?? 10) + 3 + p * 20, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const r = (n.r ?? 4) * (2.4 + p * 1.2);
        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.drawImage(glowSprite(n.color), (n.x ?? 0) - r, (n.y ?? 0) - r, r * 2, r * 2);
      }
    }
    for (const f of player.flights) this.drawFlight(ctx, f, now, k, near);

    // People: photos where we have them, lit points where we do not.
    for (const n of people) {
      const dim = near && !near.has(n.key);
      const r = n.r ?? 4;
      const fresh = clamp01(replay.activity(n) / this.refPerson);
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const avatar = this.avatars.get(n.id);
      if (avatar) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = dim ? 0.16 : 0.5 + 0.5 * Math.max(fresh, 0.1);
        ctx.drawImage(avatar, x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = dim ? 0.2 : 0.45 + 0.55 * fresh;
        ctx.strokeStyle = n.key === focusKey ? INK : n.color;
        ctx.lineWidth = (n.key === focusKey ? 1.8 : 1.1) / k;
        ctx.beginPath();
        ctx.arc(x, y, r + 0.6 / k, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = dim ? 0.12 : 0.35 + 0.65 * Math.max(fresh, 0.15);
        ctx.drawImage(glowSprite(n.color), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = dim ? withAlpha(n.color, 0.3) : INK;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2 / k, r * 0.45), 0, Math.PI * 2);
        ctx.fill();
        if (r * k >= 11 && !dim) {
          ctx.fillStyle = VOID;
          ctx.font = `600 ${Math.round(r * 0.7 * k)}px ${SANS}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(1 / k, 1 / k);
          ctx.fillText(this.initials.get(n.id) ?? "", 0, 1);
          ctx.restore();
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Labels in screen space so they stay crisp at any zoom.
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `500 10px ${MONO}`;
    const loudChannels = new Set(
      [...channels]
        .sort((a, b) => replay.activity(b) - replay.activity(a))
        .slice(0, 9)
        .map((n) => n.key),
    );
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
      const w = ctx.measureText(n.label).width + 10;
      const h = 16;
      const sx = (n.x ?? 0) * k + view.x;
      const r = (n.r ?? 4) * k;
      const sy = (n.y ?? 0) * k + view.y;
      const slots = [sy + r + 6, sy - r - 6 - h];
      const slot = slots.find((y) => free(sx - w / 2, y, sx + w / 2, y + h));
      const y = slot ?? (n.key === focusKey ? slots[0] : undefined);
      if (y === undefined) continue;
      placed.push([sx - w / 2, y, sx + w / 2, y + h]);
      ctx.fillStyle = "rgba(5, 7, 11, 0.72)";
      ctx.beginPath();
      ctx.roundRect(sx - w / 2, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = n.key === focusKey ? INK : n.kind === "channel" ? INK_2 : n.color;
      ctx.fillText(n.label, sx, y + 3);
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
    const tail = Math.max(0, head - 0.24);
    const fade = raw > 0.85 ? (1 - raw) / 0.15 : 1;
    const steps = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = f.color;
    for (let i = 0; i < steps; i += 1) {
      const u0 = tail + ((head - tail) * i) / steps;
      const u1 = tail + ((head - tail) * (i + 1)) / steps;
      const [ax, ay] = at(u0);
      const [bx, by] = at(u1);
      ctx.globalAlpha = ((i + 1) / steps) ** 2 * 0.7 * fade;
      ctx.lineWidth = ((f.kind === "mention" ? 1 : 1.4) * (0.3 + (0.7 * (i + 1)) / steps)) / k;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    const [hx, hy] = at(head);
    const g = 7 / k;
    ctx.globalAlpha = 0.8 * fade;
    ctx.drawImage(glowSprite(f.color), hx - g, hy - g, g * 2, g * 2);
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, hy, (f.kind === "mention" ? 1.1 : 1.4) / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
