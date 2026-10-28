import { type ExportFiles, parseSlackExport } from "./slack-export";
import type { Dataset } from "./types";

/*
 * A fictional company, Halcyon Kite Works, written out as a real Slack export
 * (users.json, channels.json, <channel>/<date>.json) and then parsed by the
 * same code path as an uploaded export. Every person, channel and message is
 * invented. Output is deterministic for a given seed.
 */

const TEAMS: Record<string, { channel: string; members: string[] }> = {
  product: {
    channel: "product",
    members: ["Wren Okafor", "Juno Castellane", "Idris Vantongeren", "Pella Marsh"],
  },
  eng: {
    channel: "eng",
    members: [
      "Bram Quillfeather",
      "Ottoline Ruiz",
      "Sol Achterberg",
      "Kit Varga",
      "Mirela Thorncastle",
      "Dov Ashgrove",
    ],
  },
  design: { channel: "design", members: ["Lumi Fenwright", "Teo Balderrama", "Saffi Pemberton"] },
  ops: {
    channel: "ops",
    members: [
      "Rook Halvorsen",
      "Ines Duvalier",
      "Marlo Kettering",
      "Yara Plumtree",
      "Fitz Oyelaran",
    ],
  },
  support: {
    channel: "support",
    members: [
      "Nell Brightwater",
      "Caspian Moreau",
      "Tilde Okonkwo",
      "Bastien Avery",
      "Odile Strand",
    ],
  },
  sales: {
    channel: "sales",
    members: ["Hollis Marchetti", "Priya Wexford", "Gus Lindqvist", "Sunny Abernethy"],
  },
  people: { channel: "people", members: ["Mae Corrigan", "Ezra Fallowfield"] },
  leads: { channel: "leadership", members: ["Ada Kestrel", "Ronan Silvermane", "Bea Holloway"] },
};

const TITLES: Record<string, string> = {
  product: "Product",
  eng: "Engineering",
  design: "Design",
  ops: "Operations",
  support: "Customer support",
  sales: "Sales",
  people: "People",
  leads: "Leadership",
};

// People who regularly work across two teams.
const BRIDGES: Record<string, string[]> = {
  "Wren Okafor": ["eng", "design"],
  "Kit Varga": ["ops"],
  "Rook Halvorsen": ["support"],
  "Hollis Marchetti": ["product"],
  "Nell Brightwater": ["product"],
};

const SHARED: Array<[string, number]> = [
  ["general", 1.2],
  ["random", 1.0],
  ["wins", 0.35],
  ["kite-test-flights", 0],
  ["customer-feedback", 0],
  ["launch-skyline", 0],
  ["incidents", 0],
];

const TOPICS: Record<string, string[]> = {
  product: [
    "roadmap review moved to {time}",
    "spec for {feature} is ready for comments",
    "can we cut {feature} from v1?",
    "user interview notes are up",
    "priority call: {feature} or {feature2}?",
  ],
  eng: [
    "PR for {feature} is up, needs a reviewer",
    "deploy went out, watching dashboards",
    "flaky test in the {feature} suite again",
    "pairing on {feature} after lunch?",
    "migration done, {num}k rows backfilled",
  ],
  design: [
    "new mocks for {feature} in the file",
    "type scale v3 is ready",
    "need copy for the {feature} empty state",
    "prototype for {feature} review",
    "icon set is done",
  ],
  ops: [
    "shipment {num} left the warehouse",
    "vendor confirmed the {feature} order",
    "inventory count is off by {num}",
    "updated the runbook for {feature}",
    "carrier delay on the east route",
  ],
  support: [
    "ticket spike about {feature}",
    "macro for {feature} refunds is live",
    "customer asking about {feature} timing",
    "queue is at {num}, all hands?",
    "escalating a {feature} bug",
  ],
  sales: [
    "demo with a {num}-store chain went well",
    "pipeline review at {time}",
    "lost a deal over {feature} pricing",
    "signed! {num} units",
    "need a one-pager on {feature}",
  ],
  people: [
    "offsite RSVPs due friday",
    "benefits enrollment opens monday",
    "welcome our new hire on {team}!",
    "interview loop for {team} tomorrow",
    "reminder: 1:1 notes template",
  ],
  leadership: [
    "board deck draft is up",
    "Q3 numbers look strong on {feature}",
    "hiring plan for {team}",
    "decision needed on {feature}",
    "can we lock the launch date?",
  ],
  general: [
    "all-hands at {time}",
    "the office wifi is back",
    "launch countdown: {num} days",
    "shoutout to {team} for {feature}",
    "fire drill at 2pm",
  ],
  random: [
    "who left a kite in the kitchen",
    "lunch spot recs?",
    "dog photo thread",
    "coffee machine is fixed",
    "trivia thursday, who's in",
  ],
  "launch-skyline": [
    "Skyline launch checklist updated",
    "press kit is final",
    "Skyline landing page is live on staging",
    "go/no-go at {time}",
    "Skyline pricing locked",
  ],
  incidents: [
    "checkout errors spiking, investigating",
    "root cause found in {feature}",
    "rolled back, error rate normal",
    "postmortem doc is up",
    "status page updated",
  ],
  wins: [
    "{team} shipped {feature}!",
    "record sales day",
    "NPS up {num} points",
    "customer love letter in the thread",
    "zero open tickets",
  ],
  "kite-test-flights": [
    "test flight at the pier, {num} knots",
    "the delta frame held up",
    "new spar material passed",
    "video from this morning's flight",
    "line snapped at {num}m, back to the bench",
  ],
  "customer-feedback": [
    "feedback roundup for {feature}",
    "three customers asked for {feature}",
    "survey results are in",
    "a reviewer called {feature} confusing",
    "top request this week: {feature}",
  ],
};

const FEATURES = [
  "Skyline",
  "bulk checkout",
  "gift cards",
  "order tracking",
  "spar sizing",
  "returns",
  "subscriptions",
  "storm-mode kites",
  "wholesale portal",
  "search",
];
const TIMES = ["10am", "11:30", "1pm", "2pm", "3:30", "4pm"];

const HOUR = 3_600_000;

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const dateKey = (t: number) => {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export type DemoOptions = { seed?: number; start?: Date; days?: number };

/** Build the fictional workspace as Slack export files. */
export const buildDemoExport = ({ seed = 7, start, days = 31 }: DemoOptions = {}): ExportFiles => {
  const rand = mulberry32(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const weighted = <T>(entries: Array<[T, number]>): T => {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = rand() * total;
    for (const [v, w] of entries) {
      roll -= w;
      if (roll <= 0) return v;
    }
    return entries[entries.length - 1][0];
  };

  // Default window: the most recent full 31 days ending at local midnight today.
  const origin = start ? new Date(start) : new Date();
  origin.setHours(0, 0, 0, 0);
  if (!start) origin.setDate(origin.getDate() - days);
  const t0 = origin.getTime();

  type DemoUser = { id: string; name: string; team: string; chat: number };
  const users: DemoUser[] = [];
  let seq = 0;
  for (const [team, def] of Object.entries(TEAMS)) {
    for (const name of def.members) {
      seq += 1;
      users.push({
        id: `UDEMO${String(seq).padStart(4, "0")}`,
        name,
        team,
        chat: 0.3 + rand() ** 1.8 * 2.4 + (team === "leads" ? 0.6 : 0),
      });
    }
  }

  const channelNames = [...Object.values(TEAMS).map((t) => t.channel), ...SHARED.map(([n]) => n)];
  const channels = channelNames.map((name, i) => ({
    id: `CDEMO${String(i + 1).padStart(4, "0")}`,
    name,
  }));

  const homes = new Map<string, Array<[string, number]>>();
  for (const u of users) {
    const h: Array<[string, number]> = [[TEAMS[u.team].channel, 6]];
    for (const extra of BRIDGES[u.name] ?? []) h.push([TEAMS[extra].channel, 2.5]);
    if (u.team === "leads") {
      for (const t of Object.values(TEAMS))
        if (t.channel !== "leadership") h.push([t.channel, 1.1]);
    }
    for (const [name, w] of SHARED) if (w) h.push([name, w]);
    if (["product", "support", "sales"].includes(u.team)) h.push(["customer-feedback", 1.4]);
    if (["eng", "design", "product"].includes(u.team)) h.push(["kite-test-flights", 0.8]);
    homes.set(u.id, h);
  }
  const members = new Map<string, DemoUser[]>();
  for (const u of users) {
    for (const [ch] of homes.get(u.id) ?? []) {
      if (!members.has(ch)) members.set(ch, []);
      members.get(ch)?.push(u);
    }
  }

  const fill = (template: string, channel: string) =>
    template
      .replaceAll("{feature2}", pick(FEATURES))
      .replaceAll("{feature}", pick(FEATURES))
      .replaceAll("{time}", pick(TIMES))
      .replaceAll("{num}", String(2 + Math.floor(rand() * 40)))
      .replaceAll("{team}", pick(Object.keys(TEAMS).filter((k) => TEAMS[k].channel !== channel)));

  const mentionTarget = (sender: DemoUser, channel: string) => {
    const local = (members.get(channel) ?? []).filter((u) => u.id !== sender.id);
    const pool = local.length && rand() < 0.8 ? local : users.filter((u) => u.id !== sender.id);
    return pick(pool);
  };

  const byFile = new Map<string, Array<{ type: string; user: string; text: string; ts: string }>>();
  const post = (channel: string, t: number, user: DemoUser, text: string) => {
    const key = `${channel}/${dateKey(t)}.json`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)?.push({ type: "message", user: user.id, text, ts: (t / 1000).toFixed(6) });
  };

  const senderWeights = users.map((u): [DemoUser, number] => [u, u.chat]);
  // Story beats so the replay has visible moments.
  const incidentDays = new Map([
    [5, 14],
    [18, 10],
  ]);
  const launchDay = Math.min(days - 5, 25);
  const responders = users.filter((u) => ["eng", "ops", "support", "leads"].includes(u.team));

  for (let day = 0; day < days; day += 1) {
    const dayStart = new Date(t0);
    dayStart.setDate(dayStart.getDate() + day);
    const ds = dayStart.getTime();
    const weekend = dayStart.getDay() === 0 || dayStart.getDay() === 6;
    const launchWeek = day >= launchDay - 5 && day <= launchDay + 1;

    for (let hour = 0; hour < 24; hour += 1) {
      let rate: number;
      if (weekend) rate = hour >= 10 && hour <= 20 ? 0.15 : 0.02;
      else if (hour < 7 || hour > 20) rate = 0.03;
      else if (hour === 12) rate = 0.6;
      else rate = hour >= 9 && hour <= 17 ? 1 : 0.35;
      rate *= 26 * (launchWeek ? 1.35 : 1);
      const count = Math.round(rate * (0.6 + rand() * 0.8));

      for (let i = 0; i < count; i += 1) {
        const sender = weighted(senderWeights);
        const options = [...(homes.get(sender.id) ?? [])];
        if (launchWeek && ["product", "eng", "design", "sales", "leads"].includes(sender.team)) {
          options.push(["launch-skyline", day === launchDay ? 9 : 3]);
        }
        const channel = weighted(options);
        let text = fill(pick(TOPICS[channel]), channel);
        const roll = rand();
        if (roll < 0.24) {
          text = `<@${mentionTarget(sender, channel).id}> ${text}`;
          if (roll < 0.05) text += ` cc <@${mentionTarget(sender, channel).id}>`;
        }
        post(channel, ds + hour * HOUR + Math.floor(rand() * HOUR), sender, text);
      }
    }

    const incidentHour = incidentDays.get(day);
    if (incidentHour !== undefined && !weekend) {
      for (let i = 0; i < 70; i += 1) {
        let text = fill(pick(TOPICS.incidents), "incidents");
        if (rand() < 0.4) text = `<@${pick(responders).id}> ${text}`;
        post(
          "incidents",
          ds + incidentHour * HOUR + Math.floor(rand() * 90 * 60_000),
          pick(responders),
          text,
        );
      }
    }
  }

  const files: ExportFiles = new Map();
  files.set(
    "users.json",
    JSON.stringify(
      users.map((u) => ({
        id: u.id,
        name: u.name.toLowerCase().replace(/[^a-z]+/g, "."),
        deleted: false,
        is_bot: false,
        profile: { real_name: u.name, display_name: u.name.split(" ")[0], title: TITLES[u.team] },
      })),
    ),
  );
  files.set("channels.json", JSON.stringify(channels));
  for (const [path, msgs] of byFile) {
    msgs.sort((a, b) => Number(a.ts) - Number(b.ts));
    files.set(path, JSON.stringify(msgs));
  }
  return files;
};

export const loadDemoDataset = (options?: DemoOptions): Dataset => ({
  ...parseSlackExport(buildDemoExport(options), "Halcyon Kite Works"),
  source: "demo",
});
