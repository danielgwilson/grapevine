import type { Channel, Dataset, Message, Person } from "../data/types";
import { colorForChannel, NEUTRAL } from "./palette";

export type NodeKind = "person" | "channel";

export type GraphNode = {
  key: string;
  id: string;
  kind: NodeKind;
  label: string;
  color: string;
  /** Messages so far (sender for people, received for channels). */
  total: number;
  /** Decayed activity, valid at actT. */
  act: number;
  actT: number;
  /** Sim time of first appearance; Infinity until then. */
  bornAt: number;
  /** Real (performance.now) time of the most recent pulse, for flashes. */
  pulseAt: number;
  // Written by d3-force.
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  // Smoothed draw radius, owned by the renderer.
  r?: number;
};

export type EdgeKind = "post" | "mention";

export type GraphEdge = {
  key: string;
  kind: EdgeKind;
  source: GraphNode;
  target: GraphNode;
  w: number;
  wT: number;
  total: number;
};

export type Moment = { t: number; end: number; count: number; label: string };

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const personKey = (id: string) => `p:${id}`;
const channelKey = (id: string) => `c:${id}`;

/**
 * Deterministic replay of a dataset up to a point in time. All state is a pure
 * function of (dataset, t, halfLife), so scrubbing backwards just replays from
 * the start, which is a few milliseconds even for large exports.
 */
export class Replay {
  readonly dataset: Dataset;
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  readonly people: Map<string, Person>;
  readonly channels: Map<string, Channel>;
  /** The channel each person posts in most, used for their color. */
  readonly homeChannel = new Map<string, string>();

  halfLife: number;
  t: number;
  private cursor = 0;

  constructor(dataset: Dataset, halfLife = 2 * DAY) {
    this.dataset = dataset;
    this.halfLife = halfLife;
    this.t = dataset.start;
    this.people = new Map(dataset.people.map((p) => [p.id, p]));
    this.channels = new Map(dataset.channels.map((c) => [c.id, c]));

    // Color channels by overall volume rank, people by their home channel.
    const channelVolume = new Map<string, number>();
    const personChannel = new Map<string, Map<string, number>>();
    for (const m of dataset.messages) {
      channelVolume.set(m.channel, (channelVolume.get(m.channel) ?? 0) + 1);
      let counts = personChannel.get(m.user);
      if (!counts) {
        counts = new Map();
        personChannel.set(m.user, counts);
      }
      counts.set(m.channel, (counts.get(m.channel) ?? 0) + 1);
    }
    const ranked = [...channelVolume.entries()]
      .filter(([id]) => {
        const kind = this.channels.get(id)?.kind;
        return kind === "public" || kind === "private";
      })
      .sort((a, b) => b[1] - a[1]);
    const channelColor = new Map(ranked.map(([id], i) => [id, colorForChannel(i)]));

    for (const c of dataset.channels) {
      this.nodes.set(channelKey(c.id), {
        key: channelKey(c.id),
        id: c.id,
        kind: "channel",
        label: c.name,
        color: channelColor.get(c.id) ?? NEUTRAL,
        total: 0,
        act: 0,
        actT: dataset.start,
        bornAt: Number.POSITIVE_INFINITY,
        pulseAt: Number.NEGATIVE_INFINITY,
      });
    }
    for (const p of dataset.people) {
      const counts = personChannel.get(p.id);
      let home: string | undefined;
      if (counts) {
        let best = -1;
        for (const [ch, n] of counts) {
          if (channelColor.has(ch) && n > best) {
            best = n;
            home = ch;
          }
        }
      }
      if (home) this.homeChannel.set(p.id, home);
      this.nodes.set(personKey(p.id), {
        key: personKey(p.id),
        id: p.id,
        kind: "person",
        label: p.name,
        color: (home && channelColor.get(home)) || NEUTRAL,
        total: 0,
        act: 0,
        actT: dataset.start,
        bornAt: Number.POSITIVE_INFINITY,
        pulseAt: Number.NEGATIVE_INFINITY,
      });
    }
  }

  decay(value: number, since: number, at = this.t): number {
    if (!Number.isFinite(this.halfLife) || at <= since) return value;
    return value * 2 ** (-(at - since) / this.halfLife);
  }

  activity(node: GraphNode, at = this.t) {
    return this.decay(node.act, node.actT, at);
  }

  weight(edge: GraphEdge, at = this.t) {
    return this.decay(edge.w, edge.wT, at);
  }

  node(kind: NodeKind, id: string) {
    return this.nodes.get(kind === "person" ? personKey(id) : channelKey(id));
  }

  private bumpNode(node: GraphNode, t: number, now: number) {
    node.act = this.decay(node.act, node.actT, t) + 1;
    node.actT = t;
    node.total += 1;
    node.pulseAt = now;
    if (node.bornAt === Number.POSITIVE_INFINITY) node.bornAt = t;
  }

  private bumpEdge(kind: EdgeKind, source: GraphNode, target: GraphNode, t: number) {
    const key =
      kind === "post" ? `${source.key}>${target.key}` : [source.key, target.key].sort().join("~");
    let edge = this.edges.get(key);
    if (!edge) {
      edge = { key, kind, source, target, w: 0, wT: t, total: 0 };
      this.edges.set(key, edge);
    }
    edge.w = this.decay(edge.w, edge.wT, t) + 1;
    edge.wT = t;
    edge.total += 1;
  }

  private apply(m: Message, now: number) {
    const sender = this.nodes.get(personKey(m.user));
    const channel = this.nodes.get(channelKey(m.channel));
    if (!sender || !channel) return;
    this.bumpNode(sender, m.t, now);
    this.bumpNode(channel, m.t, now);
    this.bumpEdge("post", sender, channel, m.t);
    for (const id of m.mentions) {
      const target = this.nodes.get(personKey(id));
      if (!target) continue;
      if (target.bornAt === Number.POSITIVE_INFINITY) target.bornAt = m.t;
      target.pulseAt = now;
      this.bumpEdge("mention", sender, target, m.t);
    }
  }

  private reset() {
    for (const node of this.nodes.values()) {
      node.total = 0;
      node.act = 0;
      node.actT = this.dataset.start;
      node.bornAt = Number.POSITIVE_INFINITY;
      node.pulseAt = Number.NEGATIVE_INFINITY;
    }
    this.edges.clear();
    this.cursor = 0;
  }

  /**
   * Move to time t. Returns the messages applied on the way when moving
   * forward, so the renderer can animate them. Moving backward replays from
   * the start and returns nothing.
   */
  seek(t: number, now = 0): Message[] {
    const target = Math.min(Math.max(t, this.dataset.start), this.dataset.end);
    const applied: Message[] = [];
    if (target < this.t) {
      this.reset();
      now = Number.NEGATIVE_INFINITY;
    }
    const { messages } = this.dataset;
    const track = now !== Number.NEGATIVE_INFINITY;
    while (this.cursor < messages.length && messages[this.cursor].t <= target) {
      const m = messages[this.cursor];
      this.apply(m, now);
      if (track) applied.push(m);
      this.cursor += 1;
    }
    this.t = target;
    return applied;
  }

  setHalfLife(halfLife: number) {
    if (halfLife === this.halfLife) return;
    const t = this.t;
    this.halfLife = halfLife;
    this.reset();
    this.t = this.dataset.start;
    this.seek(t, Number.NEGATIVE_INFINITY);
  }

  /** Index of the first message at or after t. */
  indexAt(t: number) {
    const { messages } = this.dataset;
    let lo = 0;
    let hi = messages.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (messages[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Most recent messages at or before the current time, newest first. */
  recent(limit: number): Message[] {
    const end = this.cursor;
    const out: Message[] = [];
    for (let i = end - 1; i >= 0 && out.length < limit; i -= 1) out.push(this.dataset.messages[i]);
    return out;
  }

  pulse() {
    const { messages } = this.dataset;
    const lastHour = this.cursor - this.indexAt(this.t - HOUR);
    const dayStart = this.indexAt(this.t - DAY);
    const voices = new Set<string>();
    for (let i = dayStart; i < this.cursor; i += 1) voices.add(messages[i].user);
    // Busiest channel over the last three hours.
    const recentByChannel = new Map<string, number>();
    for (let i = this.indexAt(this.t - 3 * HOUR); i < this.cursor; i += 1) {
      const ch = messages[i].channel;
      recentByChannel.set(ch, (recentByChannel.get(ch) ?? 0) + 1);
    }
    let hottestId: string | undefined;
    let hottestN = 0;
    for (const [ch, n] of recentByChannel) {
      if (n > hottestN) {
        hottestN = n;
        hottestId = ch;
      }
    }
    const hottest = hottestId ? this.channels.get(hottestId) : undefined;
    return {
      lastHour,
      voices24h: voices.size,
      sent: this.cursor,
      hottest: hottest?.name,
    };
  }
}

export type Histogram = { binMs: number; start: number; counts: Uint32Array; max: number };

export const histogram = (dataset: Dataset): Histogram => {
  const span = dataset.end - dataset.start;
  const binMs = span <= 120 * DAY ? HOUR : span <= 2 * 365 * DAY ? 6 * HOUR : DAY;
  const counts = new Uint32Array(Math.ceil(span / binMs));
  for (const m of dataset.messages) {
    const i = Math.floor((m.t - dataset.start) / binMs);
    if (i >= 0 && i < counts.length) counts[i] += 1;
  }
  let max = 0;
  for (const c of counts) max = Math.max(max, c);
  return { binMs, start: dataset.start, counts, max };
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Bursts of unusual activity: 3-bin windows that sit far above the typical
 * window (robust z-score on median/MAD), at most `limit`, spaced apart.
 */
export const findMoments = (dataset: Dataset, limit = 6): Moment[] => {
  // Always hourly, whatever the display histogram uses, so bursts are not smoothed away.
  const binMs = HOUR;
  const counts = new Uint32Array(Math.ceil((dataset.end - dataset.start) / binMs));
  for (const m of dataset.messages) {
    const i = Math.floor((m.t - dataset.start) / binMs);
    if (i >= 0 && i < counts.length) counts[i] += 1;
  }
  const windowBins = 3;
  const sums: number[] = [];
  for (let i = 0; i + windowBins <= counts.length; i += 1) {
    let s = 0;
    for (let j = 0; j < windowBins; j += 1) s += counts[i + j];
    sums.push(s);
  }
  const busy = sums.filter((s) => s > 0);
  const med = median(busy);
  const mad = median(busy.map((s) => Math.abs(s - med))) || 1;
  // Far above a typical window, and at least double it.
  const threshold = Math.max(med + 4 * mad, 2 * med);

  const order = sums.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const chosen: number[] = [];
  // Spread picks out: at least a day apart, more on long exports.
  const spacing = Math.max(DAY, (dataset.end - dataset.start) / 30) / binMs;
  for (const [s, i] of order) {
    if (s < threshold || chosen.length >= limit) break;
    if (chosen.some((c) => Math.abs(c - i) < spacing)) continue;
    chosen.push(i);
  }

  const channelName = new Map(dataset.channels.map((c) => [c.id, c.name]));
  return chosen
    .map((i) => {
      const t = dataset.start + i * binMs;
      const end = t + windowBins * binMs;
      const byChannel = new Map<string, number>();
      let count = 0;
      for (const m of dataset.messages) {
        if (m.t < t) continue;
        if (m.t >= end) break;
        count += 1;
        byChannel.set(m.channel, (byChannel.get(m.channel) ?? 0) + 1);
      }
      let top = "";
      let topN = 0;
      for (const [ch, n] of byChannel) {
        if (n > topN) {
          topN = n;
          top = ch;
        }
      }
      return { t, end, count, label: channelName.get(top) ?? "burst" };
    })
    .sort((a, b) => a.t - b.t);
};
