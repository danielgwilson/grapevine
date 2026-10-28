import {
  type ForceLink,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";

import type { GraphEdge, GraphNode, Replay } from "./replay";

export type LayoutLink = { source: GraphNode; target: GraphNode; edge: GraphEdge; norm: number };

/**
 * Wraps a d3-force simulation that is ticked manually from the render loop.
 * Nodes join the simulation the moment they first speak, next to whatever
 * they first connected to, so the layout grows instead of popping.
 */
export class Layout {
  readonly sim: Simulation<GraphNode, LayoutLink>;
  links: LayoutLink[] = [];
  visible: GraphNode[] = [];
  private linkForce: ForceLink<GraphNode, LayoutLink>;
  private charge = forceManyBody<GraphNode>()
    .strength((n) => (n.kind === "channel" ? -200 - (n.r ?? 8) * 12 : -36))
    .distanceMax(700)
    .theta(0.9);
  private collide = forceCollide<GraphNode>()
    .radius((n) => (n.r ?? 5) + (n.kind === "channel" ? 12 : 2.5))
    .strength(0.9)
    .iterations(2);
  private visibleKeys = new Set<string>();
  private seed = 1;

  constructor() {
    this.linkForce = forceLink<GraphNode, LayoutLink>([])
      .id((n) => n.key)
      // People orbit just outside the channels they post in.
      .distance((l) => (l.edge.kind === "post" ? (l.target.r ?? 8) + 20 + (1 - l.norm) * 46 : 80))
      .strength((l) => (l.edge.kind === "post" ? 0.04 + 0.5 * l.norm : 0.015 + 0.15 * l.norm));

    this.sim = forceSimulation<GraphNode, LayoutLink>([])
      .stop()
      .alphaDecay(0.02)
      .velocityDecay(0.35)
      .force("link", this.linkForce)
      .force("charge", this.charge)
      .force("collide", this.collide)
      .force("x", forceX<GraphNode>(0).strength(0.008))
      .force("y", forceY<GraphNode>(0).strength(0.085));
  }

  private random() {
    // Small deterministic LCG so layouts are stable between reloads.
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private place(node: GraphNode, replay: Replay) {
    if (node.x !== undefined) return;
    let anchor: GraphNode | undefined;
    for (const edge of replay.edges.values()) {
      if (edge.source === node && edge.target.x !== undefined) anchor = edge.target;
      else if (edge.target === node && edge.source.x !== undefined) anchor = edge.source;
      if (anchor) break;
    }
    const angle = this.random() * Math.PI * 2;
    if (anchor?.x !== undefined && anchor.y !== undefined) {
      const d = node.kind === "channel" ? 140 : 26 + this.random() * 24;
      node.x = anchor.x + Math.cos(angle) * d;
      node.y = anchor.y + Math.sin(angle) * d;
    } else {
      const d = 80 + this.random() * 160;
      node.x = Math.cos(angle) * d;
      node.y = Math.sin(angle) * d;
    }
    node.vx = 0;
    node.vy = 0;
  }

  /** Rebuild node and link sets from the replay. Cheap enough to run several times a second. */
  sync(replay: Replay) {
    let added = false;
    for (const node of replay.nodes.values()) {
      if (node.bornAt <= replay.t && !this.visibleKeys.has(node.key)) {
        this.visibleKeys.add(node.key);
        this.visible.push(node);
        added = true;
      }
    }
    if (this.visible.some((n) => n.bornAt > replay.t)) {
      // Rewound past some births.
      this.visible = this.visible.filter((n) => n.bornAt <= replay.t);
      this.visibleKeys = new Set(this.visible.map((n) => n.key));
      added = true;
    }
    if (added) {
      // Channels first so people can anchor to them.
      for (const node of this.visible) if (node.kind === "channel") this.place(node, replay);
      for (const node of this.visible) this.place(node, replay);
      this.sim.nodes(this.visible);
    }

    let maxPost = 0;
    let maxMention = 0;
    const weights = new Map<GraphEdge, number>();
    for (const edge of replay.edges.values()) {
      const w = replay.weight(edge);
      weights.set(edge, w);
      if (edge.kind === "post") maxPost = Math.max(maxPost, w);
      else maxMention = Math.max(maxMention, w);
    }

    const links: LayoutLink[] = [];
    for (const [edge, w] of weights) {
      if (!this.visibleKeys.has(edge.source.key) || !this.visibleKeys.has(edge.target.key))
        continue;
      const max = edge.kind === "post" ? maxPost : maxMention;
      const norm = max > 0 ? w / max : 0;
      if (norm < 0.01 && w < 0.05) continue;
      links.push({ source: edge.source, target: edge.target, edge, norm });
    }
    this.links = links;
    this.linkForce.links(links);
    // d3 caches per-node radii and strengths at initialize; refresh them as nodes grow.
    this.charge.strength(this.charge.strength());
    this.collide.radius(this.collide.radius());
    this.sim.alpha(Math.max(this.sim.alpha(), added ? 0.45 : 0.08));
  }

  reset() {
    for (const node of this.visible) {
      node.x = undefined;
      node.y = undefined;
    }
    this.visible = [];
    this.visibleKeys.clear();
    this.links = [];
    this.seed = 1;
    this.sim.nodes([]);
    this.linkForce.links([]);
  }

  tick(breathing: boolean) {
    this.sim.alphaTarget(breathing ? 0.035 : 0);
    if (this.sim.alpha() > 0.003 || breathing) this.sim.tick();
  }
}
