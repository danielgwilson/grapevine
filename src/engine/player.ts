import type { Dataset, Message } from "../data/types";
import { Layout } from "./layout";
import { MENTION } from "./palette";
import { DAY, findMoments, type GraphNode, HOUR, histogram, type Moment, Replay } from "./replay";

export const SPEEDS = [
  { label: "1h", perSecond: HOUR },
  { label: "3h", perSecond: 3 * HOUR },
  { label: "6h", perSecond: 6 * HOUR },
  { label: "12h", perSecond: 12 * HOUR },
  { label: "1d", perSecond: DAY },
  { label: "3d", perSecond: 3 * DAY },
] as const;

export const MEMORY = [
  { label: "6h", halfLife: 6 * HOUR },
  { label: "2d", halfLife: 2 * DAY },
  { label: "1w", halfLife: 7 * DAY },
  { label: "all", halfLife: Number.POSITIVE_INFINITY },
] as const;

export type Flight = {
  from: GraphNode;
  to: GraphNode;
  start: number;
  duration: number;
  color: string;
  kind: "post" | "mention";
  /** Curve bend, signed, so parallel flights fan out. */
  bend: number;
};

export type FocusRow = { key: string; label: string; color: string; value: number };

export type Focus = {
  key: string;
  kind: GraphNode["kind"];
  label: string;
  subtitle: string;
  color: string;
  total: number;
  rows: { title: string; items: FocusRow[] }[];
  messages: Message[];
};

export type Snapshot = {
  t: number;
  playing: boolean;
  speed: number;
  memory: number;
  follow: boolean;
  pulse: ReturnType<Replay["pulse"]>;
  feed: Message[];
  focus?: Focus;
  pinned?: string;
};

const MAX_FLIGHTS = 500;
const MAX_NEW_FLIGHTS_PER_FRAME = 36;

export class Player {
  readonly dataset: Dataset;
  readonly replay: Replay;
  readonly layout = new Layout();
  readonly hist;
  readonly moments: Moment[];

  playing = false;
  speed = 2;
  memory = 1;
  follow = true;
  hovered?: string;
  pinned?: string;
  flights: Flight[] = [];

  private lastFrame = 0;
  private lastSync = 0;
  private lastEmit = 0;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private flip = 1;

  constructor(dataset: Dataset) {
    this.dataset = dataset;
    this.replay = new Replay(dataset, MEMORY[this.memory].halfLife);
    this.hist = histogram(dataset);
    this.moments = findMoments(dataset);
    // Open on the first weekday morning with real activity so the graph is never empty.
    this.replay.seek(this.openingTime(), Number.NEGATIVE_INFINITY);
    this.layout.sync(this.replay);
    for (let i = 0; i < 220; i += 1) this.layout.tick(false);
    this.snapshot = this.build();
  }

  private openingTime() {
    const { messages, start } = this.dataset;
    const target = Math.min(
      messages.length - 1,
      Math.max(20, Math.min(600, Math.floor(messages.length * 0.04))),
    );
    return Math.max(start, messages[target]?.t ?? start);
  }

  // ---- store ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  emit() {
    this.snapshot = this.build();
    for (const fn of this.listeners) fn();
  }

  // ---- controls ----
  play() {
    if (this.replay.t >= this.dataset.end) this.seek(this.dataset.start);
    this.playing = true;
    this.emit();
  }
  pause() {
    this.playing = false;
    this.emit();
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  seek(t: number) {
    const hop = t - this.replay.t;
    // Short forward hops (arrow keys) still animate; rewinds and long jumps do not.
    const animate = hop > 0 && hop <= 2 * HOUR;
    const now = performance.now();
    const applied = this.replay.seek(t, animate ? now : Number.NEGATIVE_INFINITY);
    if (animate) this.launch(applied, now);
    else this.flights = [];
    this.dropUnbornFocus();
    this.layout.sync(this.replay);
    this.emit();
  }
  step(ms: number) {
    this.seek(this.replay.t + ms);
  }
  setSpeed(i: number) {
    this.speed = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.emit();
  }
  setMemory(i: number) {
    this.memory = i;
    this.replay.setHalfLife(MEMORY[i].halfLife);
    this.dropUnbornFocus();
    this.layout.sync(this.replay);
    this.emit();
  }
  setFollow(follow: boolean) {
    if (this.follow === follow) return;
    this.follow = follow;
    this.emit();
  }
  hover(key: string | undefined) {
    if (key === this.hovered) return;
    this.hovered = key;
    this.emit();
  }
  pin(key: string | undefined) {
    this.pinned = key === this.pinned ? undefined : key;
    this.emit();
  }

  /** After a rewind, forget focus on nodes that have not appeared yet. */
  private dropUnbornFocus() {
    const unborn = (key?: string) =>
      key !== undefined &&
      (this.replay.nodes.get(key)?.bornAt ?? Number.POSITIVE_INFINITY) > this.replay.t;
    if (unborn(this.pinned)) this.pinned = undefined;
    if (unborn(this.hovered)) this.hovered = undefined;
  }

  get focusKey() {
    return this.pinned ?? this.hovered;
  }

  // ---- frame ----
  frame(now: number) {
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;

    if (this.playing) {
      const next = this.replay.t + (dt / 1000) * SPEEDS[this.speed].perSecond;
      const applied = this.replay.seek(next, now);
      this.launch(applied, now);
      if (this.replay.t >= this.dataset.end) this.playing = false;
    }

    this.flights = this.flights.filter((f) => now - f.start < f.duration);

    if (now - this.lastSync > (this.playing ? 120 : 400)) {
      this.layout.sync(this.replay);
      this.lastSync = now;
    }
    this.layout.tick(this.playing);

    if (now - this.lastEmit > (this.playing ? 125 : 500)) {
      this.lastEmit = now;
      this.emit();
    }
  }

  private launch(messages: Message[], now: number) {
    if (messages.length === 0) return;
    // At high speed a frame can carry hundreds of messages; animate a sample.
    const stride = Math.max(1, Math.ceil(messages.length / MAX_NEW_FLIGHTS_PER_FRAME));
    const duration = Math.max(520, 1100 - this.speed * 110);
    for (let i = messages.length - 1; i >= 0; i -= stride) {
      const m = messages[i];
      const from = this.replay.node("person", m.user);
      const to = this.replay.node("channel", m.channel);
      if (!from || !to) continue;
      this.flip = -this.flip;
      this.flights.push({
        from,
        to,
        start: now + Math.random() * 60,
        duration,
        color: from.color,
        kind: "post",
        bend: this.flip * (0.12 + Math.random() * 0.18),
      });
      for (const id of m.mentions) {
        const target = this.replay.node("person", id);
        if (!target) continue;
        this.flights.push({
          from,
          to: target,
          start: now + 80,
          duration: duration * 1.15,
          color: MENTION,
          kind: "mention",
          bend: 0.35,
        });
      }
    }
    if (this.flights.length > MAX_FLIGHTS)
      this.flights.splice(0, this.flights.length - MAX_FLIGHTS);
  }

  // ---- derived ----
  private build(): Snapshot {
    return {
      t: this.replay.t,
      playing: this.playing,
      speed: this.speed,
      memory: this.memory,
      follow: this.follow,
      pulse: this.replay.pulse(),
      feed: this.replay.recent(9),
      focus: this.focusKey ? this.describe(this.focusKey) : undefined,
      pinned: this.pinned,
    };
  }

  private describe(key: string): Focus | undefined {
    const node = this.replay.nodes.get(key);
    if (!node || node.bornAt > this.replay.t) return undefined;
    const { replay } = this;
    const byNeighbor = new Map<GraphNode, number>();
    const byMention = new Map<GraphNode, number>();
    for (const edge of replay.edges.values()) {
      if (edge.kind === "post") {
        const other =
          edge.source === node ? edge.target : edge.target === node ? edge.source : undefined;
        if (other) byNeighbor.set(other, (byNeighbor.get(other) ?? 0) + edge.total);
      } else {
        const other =
          edge.source === node ? edge.target : edge.target === node ? edge.source : undefined;
        if (other) byMention.set(other, (byMention.get(other) ?? 0) + edge.total);
      }
    }
    const top = (m: Map<GraphNode, number>): FocusRow[] =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([n, value]) => ({ key: n.key, label: n.label, color: n.color, value }));

    // Their latest messages up to now (bounded scan).
    const messages: Message[] = [];
    const { messages: all } = this.dataset;
    const end = replay.indexAt(replay.t + 1);
    for (let i = end - 1; i >= 0 && i > end - 20000 && messages.length < 4; i -= 1) {
      const m = all[i];
      if (
        (node.kind === "person" && m.user === node.id) ||
        (node.kind === "channel" && m.channel === node.id)
      ) {
        messages.push(m);
      }
    }

    if (node.kind === "person") {
      const person = replay.people.get(node.id);
      const home = replay.homeChannel.get(node.id);
      const homeName = home ? replay.channels.get(home)?.name : undefined;
      return {
        key,
        kind: node.kind,
        label: person?.fullName ?? node.label,
        subtitle: [person?.title, homeName && `mostly in ${homeName}`].filter(Boolean).join(" · "),
        color: node.color,
        total: node.total,
        rows: [
          { title: "Posts in", items: top(byNeighbor) },
          { title: "Mentions with", items: top(byMention) },
        ].filter((r) => r.items.length > 0),
        messages,
      };
    }
    const channel = replay.channels.get(node.id);
    return {
      key,
      kind: node.kind,
      label: node.label,
      subtitle: `${byNeighbor.size} ${byNeighbor.size === 1 ? "voice" : "voices"} so far${channel?.kind === "private" ? " · private" : ""}`,
      color: node.color,
      total: node.total,
      rows: [{ title: "Loudest voices", items: top(byNeighbor) }],
      messages,
    };
  }
}
