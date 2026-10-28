import { describe, expect, it } from "vitest";

import { loadDemoDataset } from "../data/demo";
import type { Dataset } from "../data/types";
import { DAY, findMoments, HOUR, Replay } from "./replay";

const t0 = new Date(2025, 0, 6).getTime();

const tiny: Dataset = {
  label: "tiny",
  source: "demo",
  people: [
    { id: "A", name: "A", fullName: "A" },
    { id: "B", name: "B", fullName: "B" },
  ],
  channels: [{ id: "C", name: "#c", kind: "public" }],
  messages: [
    { t: t0 + HOUR, user: "A", channel: "C", mentions: ["B"], text: "" },
    { t: t0 + 2 * HOUR, user: "A", channel: "C", mentions: [], text: "" },
    { t: t0 + 26 * HOUR, user: "B", channel: "C", mentions: [], text: "" },
  ],
  start: t0,
  end: t0 + 2 * DAY,
};

const snapshot = (r: Replay) =>
  [...r.nodes.values()].map((n) => [n.key, n.total, n.bornAt, Number(r.activity(n).toFixed(9))]);

describe("Replay", () => {
  it("counts, births and decays activity with the half-life", () => {
    const r = new Replay(tiny, DAY);
    r.seek(t0 + 2 * HOUR);
    const a = r.node("person", "A");
    const b = r.node("person", "B");
    expect(a?.total).toBe(2);
    // B was mentioned before ever speaking, so it is on the graph with no messages.
    expect(b?.bornAt).toBe(t0 + HOUR);
    expect(b?.total).toBe(0);
    r.seek(t0 + 2 * HOUR + DAY);
    expect(a && r.activity(a)).toBeCloseTo((2 ** (-1 / 24) + 1) / 2, 9);
  });

  it("gives the same state whether you play forward or scrub back", () => {
    const ds = loadDemoDataset({ start: new Date(2025, 7, 1) });
    const mid = ds.start + 12 * DAY + 5 * HOUR;
    const forward = new Replay(ds);
    for (let t = ds.start; t < mid; t += 37 * 60_000) forward.seek(t);
    forward.seek(mid);
    const back = new Replay(ds);
    back.seek(ds.end);
    back.seek(mid);
    expect(snapshot(back)).toEqual(snapshot(forward));
    expect(back.edges.size).toBe(forward.edges.size);
  });

  it("returns applied messages only when moving forward", () => {
    const r = new Replay(tiny);
    expect(r.seek(t0 + 3 * HOUR, 1)).toHaveLength(2);
    expect(r.seek(t0, 1)).toHaveLength(0);
  });

  it("re-derives state when memory changes", () => {
    const r = new Replay(tiny, HOUR);
    r.seek(t0 + 26 * HOUR);
    const c = r.node("channel", "C");
    const short = c ? r.activity(c) : 0;
    r.setHalfLife(Number.POSITIVE_INFINITY);
    expect(c && r.activity(c)).toBe(3);
    expect(short).toBeLessThan(1.1);
  });
});

describe("moments", () => {
  it("finds the demo's two incident storms and launch day", () => {
    const ds = loadDemoDataset({ start: new Date(2025, 7, 1) });
    const moments = findMoments(ds);
    const labels = moments.map((m) => m.label);
    expect(labels.filter((l) => l === "#incidents")).toHaveLength(2);
    expect(labels).toContain("#launch-skyline");
  });
});
