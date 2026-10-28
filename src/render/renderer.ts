import { MENTION, withAlpha } from "../engine/palette";
import type { Flight, Player } from "../engine/player";
import type { GraphNode } from "../engine/replay";

export type View = { k: number; x: number; y: number; width: number; height: number; dpr: number };
export type Camera = { k: number; x: number; y: number };

const VOID = "#05070b";
const INK = "#eef3ff";
const INK_2 = "#aab4c8";
const MONO = '"Martian Mono Variable", ui-monospace, monospace';
const SANS = '"Geist Variable", system-ui, sans-serif';

const PULSE_MS = 900;
/** How far nodes dim when something else has focus: gentle on hover, firmer when pinned. */
const DIM_HOVER = 0.26;
const DIM_PINNED = 0.12;
/** How long a portrait stays in color after its person speaks. */
const TINT_MS = 1800;
const AVATAR_PX = 128;

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Frame-rate independent exponential approach: fraction to move this frame for time constant tau. */
const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

const initialsOf = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

/** Endpoints pulled in to the rims of two circles, so lines land on rings instead of centers. */
const rims = (a: GraphNode, b: GraphNode, ra: number, rb: number) => {
  const ax = a.x ?? 0;
  const ay = a.y ?? 0;
  const bx = b.x ?? 0;
  const by = b.y ?? 0;
  const d = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / d;
  const uy = (by - ay) / d;
  const ia = Math.min(ra, d * 0.45);
  const ib = Math.min(rb, d * 0.45);
  return [ax + ux * ia, ay + uy * ia, bx - ux * ib, by - uy * ib] as const;
};

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

type Portrait = { color: HTMLCanvasElement; gray: HTMLCanvasElement };

export class Renderer {
  private refChannel = 1;
  private refPerson = 1;
  private dim = DIM_HOVER;
  private lastNow = 0;
  private initials = new Map<string, string>();
  /** Circular, pre-cropped portraits (color and a cool grayscale twin) keyed by person id. */
  private portraits = new Map<string, Portrait>();

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
      const crop = (filter: string) => {
        const c = document.createElement("canvas");
        c.width = c.height = AVATAR_PX;
        const g = c.getContext("2d");
        if (!g) return c;
        g.filter = filter;
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
        return c;
      };
      this.portraits.set(id, {
        color: crop("none"),
        gray: crop("grayscale(1) brightness(0.8) contrast(1.05)"),
      });
    };
    // A missing photo just falls back to a lit point.
    img.onerror = () => undefined;
    img.src = url;
  }

  /** Camera that frames the given nodes inside the free area of the stage. */
  private frame(view: View, nodes: GraphNode[], maxK: number, pad: number): Camera | undefined {
    if (nodes.length === 0) return undefined;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      const r = (n.r ?? 6) + pad;
      x0 = Math.min(x0, (n.x ?? 0) - r);
      y0 = Math.min(y0, (n.y ?? 0) - r);
      x1 = Math.max(x1, (n.x ?? 0) + r);
      y1 = Math.max(y1, (n.y ?? 0) + r);
    }
    const top = view.height > 420 ? 132 : 92;
    const bottom = 40;
    const side = 36;
    const availW = Math.max(80, view.width - side * 2);
    const availH = Math.max(80, view.height - top - bottom);
    const k = Math.max(0.12, Math.min(maxK, availW / (x1 - x0), availH / (y1 - y0)));
    return {
      k,
      x: side + availW / 2 - ((x0 + x1) / 2) * k,
      y: top + availH / 2 - ((y0 + y1) / 2) * k,
    };
  }

  /** Everything that has appeared so far. */
  fit(view: View) {
    return this.frame(view, this.player.layout.visible, 1.8, 18);
  }

  /** The pinned node and its strongest connections, always noticeably closer than the overview. */
  fitFocus(view: View, key: string) {
    const { replay } = this.player;
    const node = replay.nodes.get(key);
    if (!node || node.bornAt > replay.t || node.x === undefined) return undefined;
    const ties: Array<[GraphNode, number]> = [];
    for (const e of replay.edges.values()) {
      const other = e.source === node ? e.target : e.target === node ? e.source : undefined;
      if (other && other.x !== undefined && other.bornAt <= replay.t) ties.push([other, e.total]);
    }
    ties.sort((a, b) => b[1] - a[1]);
    const cam = this.frame(view, [node, ...ties.slice(0, 6).map(([n]) => n)], 2.6, 30);
    const all = this.fit(view);
    if (!cam || !all) return cam;
    const k = Math.min(2.6, Math.max(cam.k, all.k * 1.35));
    // Keep the framing's center, at the stronger zoom.
    const cx = (view.width / 2 - cam.x) / cam.k;
    const cy = (view.height / 2 - cam.y) / cam.k;
    return { k, x: view.width / 2 - cx * k, y: view.height / 2 - cy * k + 20 };
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
    const dt = this.lastNow ? Math.min(64, Math.max(0, now - this.lastNow)) : 16;
    this.lastNow = now;
    const fast = approach(dt, 140);
    const slow = approach(dt, 420);

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
    this.refChannel += (Math.max(maxC, 1) - this.refChannel) * approach(dt, 300);
    this.refPerson += (Math.max(maxP, 1) - this.refPerson) * approach(dt, 300);

    // Focus: who is lit, eased so nothing snaps.
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
    this.dim += ((player.pinned ? DIM_PINNED : DIM_HOVER) - this.dim) * fast;

    for (const n of layout.visible) {
      const norm = clamp01(
        replay.activity(n) / (n.kind === "channel" ? this.refChannel : this.refPerson),
      );
      const target =
        n.kind === "channel"
          ? 10 + 26 * Math.sqrt(norm)
          : this.portraits.has(n.id)
            ? 6 + 9 * Math.sqrt(norm)
            : 2.5 + 6 * Math.sqrt(norm);
      n.r = n.r === undefined ? target * 0.4 : n.r + (target - n.r) * approach(dt, 220);
      n.appear = (n.appear ?? 0) + (1 - (n.appear ?? 0)) * slow;
      const emphTarget = near && !near.has(n.key) ? 0 : 1;
      n.emph = (n.emph ?? 1) + (emphTarget - (n.emph ?? 1)) * fast;
      // Portraits warm into color when their person speaks or is in focus.
      const lit = Math.max(near?.has(n.key) ? 1 : 0, clamp01(1 - (now - n.pulseAt) / TINT_MS));
      n.tint =
        (n.tint ?? 0) + (lit - (n.tint ?? 0)) * approach(dt, lit > (n.tint ?? 0) ? 120 : 600);
    }
    const vis = (n: GraphNode) => (this.dim + (1 - this.dim) * (n.emph ?? 1)) * (n.appear ?? 1);

    const channels = layout.visible.filter((n) => n.kind === "channel");
    const people = layout.visible.filter((n) => n.kind === "person");

    // Edges and glows add light, so overlaps brighten instead of muddying.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const link of layout.links) {
      const { source: s, target: t, edge, norm } = link;
      const touched = edge.source.key === focusKey || edge.target.key === focusKey;
      const mTarget = near ? (touched ? 2.4 : 0.18) : 1;
      edge.emph = (edge.emph ?? 1) + (mTarget - (edge.emph ?? 1)) * fast;
      const base = edge.kind === "post" ? 0.035 + 0.26 * norm : 0.03 + 0.2 * norm;
      const alpha = Math.min(0.75, base * edge.emph) * Math.min(s.appear ?? 1, t.appear ?? 1);
      if (alpha < 0.008) continue;
      const [x0, y0, x1, y1] = rims(s, t, (s.r ?? 4) + 1 / k, (t.r ?? 4) + 1 / k);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = withAlpha(edge.kind === "post" ? s.color : MENTION, alpha);
      ctx.lineWidth = (edge.kind === "post" ? 0.5 + 1.5 * norm : 0.5 + 1.1 * norm) / Math.sqrt(k);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      if (edge.kind === "mention") {
        const mx = (x0 + x1) / 2 - (y1 - y0) * 0.18;
        const my = (y0 + y1) / 2 + (x1 - x0) * 0.18;
        ctx.quadraticCurveTo(mx, my, x1, y1);
      } else {
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }

    // Channel halos: faint and capped, so channels read as places, not bubbles.
    for (const n of channels) {
      const r = n.r ?? 10;
      const fresh = clamp01(replay.activity(n) / this.refChannel);
      const flash = clamp01(1 - (now - n.pulseAt) / 700);
      ctx.globalAlpha = Math.min(0.22, 0.05 + 0.13 * fresh + flash * 0.06) * vis(n);
      ctx.drawImage(
        glowSprite(n.color),
        (n.x ?? 0) - r * 1.2,
        (n.y ?? 0) - r * 1.2,
        r * 2.4,
        r * 2.4,
      );
    }
    ctx.globalCompositeOperation = "source-over";
    for (const n of channels) {
      const r = (n.r ?? 10) * (0.85 + 0.15 * (n.appear ?? 1));
      const fresh = clamp01(replay.activity(n) / this.refChannel);
      ctx.globalAlpha = vis(n);
      ctx.strokeStyle = withAlpha(n.color, 0.22 + 0.5 * fresh);
      ctx.lineWidth = (n.key === focusKey ? 1.6 : 0.9) / k;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha(n.color, 0.35 + 0.45 * fresh);
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, 1.3 / Math.sqrt(k), 0, Math.PI * 2);
      ctx.fill();
    }

    // Ripples, person glows and flights.
    ctx.globalCompositeOperation = "lighter";
    for (const n of layout.visible) {
      const age = now - n.pulseAt;
      if (age < 0 || age > PULSE_MS) continue;
      const p = age / PULSE_MS;
      const v = vis(n);
      if (n.kind === "channel") {
        ctx.globalAlpha = (1 - p) * (1 - p) * 0.4 * v;
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 0.9 / k;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, (n.r ?? 10) + 2 + easeInOut(p) * 18, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const r = (n.r ?? 4) * (2.2 + p * 1.2);
        ctx.globalAlpha = (1 - p) * 0.45 * v;
        ctx.drawImage(glowSprite(n.color), (n.x ?? 0) - r, (n.y ?? 0) - r, r * 2, r * 2);
      }
    }
    // Busy channels keep their color: comets into a crowded target share the light.
    const inbound = new Map<GraphNode, number>();
    for (const f of player.flights) inbound.set(f.to, (inbound.get(f.to) ?? 0) + 1);
    for (const f of player.flights) {
      const n = inbound.get(f.to) ?? 1;
      this.drawFlight(ctx, f, now, k, n > 8 ? Math.sqrt(8 / n) : 1);
    }

    // People: grayscale portraits that warm into color, or lit points without a photo.
    for (const n of people) {
      const v = vis(n);
      const grow = 0.6 + 0.4 * (n.appear ?? 1);
      const r = (n.r ?? 4) * grow;
      const fresh = clamp01(replay.activity(n) / this.refPerson);
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const portrait = this.portraits.get(n.id);
      if (portrait) {
        const tint = n.tint ?? 0;
        const a = (0.6 + 0.4 * Math.max(fresh, 0.2)) * v;
        ctx.globalCompositeOperation = "source-over";
        if (tint < 0.99) {
          ctx.globalAlpha = a;
          ctx.drawImage(portrait.gray, x - r, y - r, r * 2, r * 2);
        }
        if (tint > 0.01) {
          ctx.globalAlpha = a * tint;
          ctx.drawImage(portrait.color, x - r, y - r, r * 2, r * 2);
        }
        const focused = n.key === focusKey;
        if ((n.emph ?? 1) > 0.4) {
          ctx.globalAlpha = (focused ? 1 : 0.25 + 0.45 * Math.max(fresh, tint)) * v;
          ctx.strokeStyle = focused ? INK : n.color;
          ctx.lineWidth = (focused ? 1.6 : 1) / k;
          ctx.beginPath();
          ctx.arc(x, y, r + 0.6 / k, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (0.35 + 0.65 * Math.max(fresh, 0.15)) * v;
        ctx.drawImage(glowSprite(n.color), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = v;
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2 / k, r * 0.45), 0, Math.PI * 2);
        ctx.fill();
        if (r * k >= 11 && v > 0.6) {
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

    this.drawLabels(ctx, view, channels, people, near, focusKey, dt);
  }

  /** Haloed labels in screen space, placed greedily around faces, fading in and out. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    view: View,
    channels: GraphNode[],
    people: GraphNode[],
    near: Set<string> | undefined,
    focusKey: string | undefined,
    dt: number,
  ) {
    const { replay, layout } = this.player;
    const { k } = view;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `500 10px ${MONO}`;
    ctx.lineJoin = "round";

    const loud = new Set(
      [...channels]
        .sort((a, b) => replay.activity(b) - replay.activity(a))
        .slice(0, 9)
        .map((n) => n.key),
    );
    const wanted = layout.visible
      .filter((n) =>
        near ? near.has(n.key) : n.kind === "channel" && (loud.has(n.key) || (n.r ?? 0) * k > 16),
      )
      .sort(
        (a, b) =>
          Number(b.key === focusKey) - Number(a.key === focusKey) ||
          Number(b.kind === "channel") - Number(a.kind === "channel") ||
          replay.activity(b) - replay.activity(a),
      );

    // Faces are obstacles: labels route around them instead of covering them.
    const placed: Array<[number, number, number, number]> = [];
    for (const p of people) {
      if ((p.emph ?? 1) < 0.5) continue;
      const sx = (p.x ?? 0) * k + view.x;
      const sy = (p.y ?? 0) * k + view.y;
      const r = (p.r ?? 4) * k;
      placed.push([sx - r, sy - r, sx + r, sy + r]);
    }
    const free = (self: GraphNode, x0: number, y0: number, x1: number, y1: number) => {
      const sx = (self.x ?? 0) * k + view.x;
      const sy = (self.y ?? 0) * k + view.y;
      return placed.every(([a0, b0, a1, b1]) => {
        // A node's own face never blocks its own label.
        if (Math.abs((a0 + a1) / 2 - sx) < 0.5 && Math.abs((b0 + b1) / 2 - sy) < 0.5) return true;
        return x1 < a0 || x0 > a1 || y1 < b0 || y0 > b1;
      });
    };
    const shown = new Set<GraphNode>();
    const h = 14;
    for (const n of wanted) {
      const w = ctx.measureText(n.label).width + 6;
      const sx = (n.x ?? 0) * k + view.x;
      const sy = (n.y ?? 0) * k + view.y;
      const r = (n.r ?? 4) * k;
      const below = r + 5;
      const above = -r - 5 - h;
      const dy = [below, above].find((d) => free(n, sx - w / 2, sy + d, sx + w / 2, sy + d + h));
      const use = dy ?? (n.key === focusKey ? below : undefined);
      if (use === undefined) continue;
      placed.push([sx - w / 2, sy + use, sx + w / 2, sy + use + h]);
      n.labelDy = use;
      shown.add(n);
    }

    const ease = approach(dt, 160);
    for (const n of layout.visible) {
      n.labelA = (n.labelA ?? 0) + ((shown.has(n) ? 1 : 0) - (n.labelA ?? 0)) * ease;
      if ((n.labelA ?? 0) < 0.02 || n.labelDy === undefined) continue;
      const sx = (n.x ?? 0) * k + view.x;
      const y = (n.y ?? 0) * k + view.y + n.labelDy + 2;
      ctx.globalAlpha = (n.labelA ?? 0) * (n.appear ?? 1);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(5, 7, 11, 0.9)";
      ctx.strokeText(n.label, sx, y);
      ctx.fillStyle = n.key === focusKey ? INK : n.kind === "channel" ? INK_2 : "#d6deec";
      ctx.fillText(n.label, sx, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawFlight(
    ctx: CanvasRenderingContext2D,
    f: Flight,
    now: number,
    k: number,
    share: number,
  ) {
    const raw = (now - f.start) / f.duration;
    if (raw <= 0 || raw >= 1) return;
    // Flights outside the focus fade with their endpoints instead of vanishing.
    const v = Math.max(
      this.dim + (1 - this.dim) * (f.from.emph ?? 1),
      this.dim + (1 - this.dim) * (f.to.emph ?? 1),
    );
    // Leave from the sender's rim, land on the target's ring.
    const [x0, y0, x2, y2] = rims(f.from, f.to, f.from.r ?? 4, f.to.r ?? 4);
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
    const fade = (raw > 0.85 ? (1 - raw) / 0.15 : 1) * v * share;
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
    ctx.globalAlpha = 0.75 * fade;
    ctx.drawImage(glowSprite(f.color), hx - g, hy - g, g * 2, g * 2);
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, hy, (f.kind === "mention" ? 1.1 : 1.4) / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
