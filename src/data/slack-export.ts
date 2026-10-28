import type { Channel, ChannelKind, Dataset, Message, Person } from "./types";

/**
 * A Slack export as a map of path -> file text, e.g.
 *   "users.json", "channels.json", "general/2025-08-01.json".
 * Paths may carry a shared top-level folder (common when an export is re-zipped);
 * it is stripped automatically.
 */
export type ExportFiles = Map<string, string>;

type RawUser = {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string; title?: string };
};

type RawChannel = { id: string; name?: string; members?: string[] };

type RawMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  /** Present on messages from people missing from users.json (e.g. Slack Connect guests). */
  user_profile?: { real_name?: string; display_name?: string; name?: string };
};

// Subtypes that are system noise rather than someone talking.
const SKIP_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "bot_message",
  "bot_add",
  "bot_remove",
  "pinned_item",
  "reminder_add",
  "tombstone",
]);

const DAY = 86_400_000;

const parseJson = <T>(files: ExportFiles, path: string, fallback: T): T => {
  const raw = files.get(path);
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Could not parse ${path} as JSON.`);
  }
};

/** Strip a single shared top-level folder if every path has one. */
export const normalizeExportPaths = (files: ExportFiles): ExportFiles => {
  if (files.has("users.json")) return files;
  const roots = new Set([...files.keys()].map((p) => p.split("/")[0]));
  if (roots.size !== 1) return files;
  const [root] = roots;
  const out: ExportFiles = new Map();
  for (const [p, text] of files) out.set(p.slice(root.length + 1), text);
  return out;
};

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;

export const extractMentions = (text: string): string[] => {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION)) ids.add(match[1]);
  return [...ids];
};

export const renderPreview = (
  text: string,
  peopleById: Map<string, Person>,
  channelsById: Map<string, Channel>,
): string => {
  const out = text
    .replace(MENTION, (_, id: string) => `@${peopleById.get(id)?.name ?? "someone"}`)
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, label?: string) => {
      const name = channelsById.get(id)?.name ?? (label ? `#${label}` : "#channel");
      return name;
    })
    .replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, (_, url: string) => url.replace(/^https?:\/\//, ""))
    .replace(/\s+/g, " ")
    .trim();
  return decodeEntities(out).slice(0, 180);
};

const personFrom = (u: RawUser): Person => {
  const display = u.profile?.display_name?.trim();
  const real = u.profile?.real_name?.trim();
  const handle = u.name?.trim() || u.id;
  return {
    id: u.id,
    name: display || real?.split(" ")[0] || handle,
    fullName: real || display || handle,
    title: u.profile?.title?.trim() || undefined,
  };
};

/** Parse a Slack workspace export into a Dataset. Pure: no I/O. */
export const parseSlackExport = (input: ExportFiles, label: string): Dataset => {
  const files = normalizeExportPaths(input);
  if (!files.has("users.json")) {
    throw new Error("This does not look like a Slack export: users.json is missing.");
  }

  const rawUsers = parseJson<RawUser[]>(files, "users.json", []);
  const people = rawUsers.filter((u) => !u.is_bot && u.id !== "USLACKBOT").map(personFrom);
  const botIds = new Set(rawUsers.filter((u) => u.is_bot).map((u) => u.id));
  const peopleById = new Map(people.map((p) => [p.id, p]));

  // Each source maps a folder name in the export to a channel.
  const folders = new Map<string, Channel>();
  const addChannels = (file: string, kind: ChannelKind, folderKey: "name" | "id") => {
    for (const c of parseJson<RawChannel[]>(files, file, [])) {
      let name: string;
      if (kind === "dm") {
        const others = (c.members ?? []).map((m) => peopleById.get(m)?.name ?? "someone");
        name = `dm: ${others.join(" + ")}`;
      } else if (kind === "group-dm") {
        name = `group: ${(c.members ?? []).length} people`;
      } else {
        name = `#${c.name ?? c.id}`;
      }
      const folder = folderKey === "id" ? c.id : (c.name ?? c.id);
      folders.set(folder, { id: c.id, name, kind });
    }
  };
  addChannels("channels.json", "public", "name");
  addChannels("groups.json", "private", "name");
  addChannels("mpims.json", "group-dm", "name");
  addChannels("dms.json", "dm", "id");

  const channelsById = new Map([...folders.values()].map((c) => [c.id, c]));
  const messages: Message[] = [];

  for (const [path, text] of files) {
    const slash = path.lastIndexOf("/");
    if (slash < 0 || !path.endsWith(".json")) continue;
    const channel = folders.get(path.slice(0, slash));
    if (!channel) continue;

    let entries: RawMessage[];
    try {
      entries = JSON.parse(text) as RawMessage[];
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;

    for (const m of entries) {
      if (!m || (m.type && m.type !== "message")) continue;
      if (m.subtype && SKIP_SUBTYPES.has(m.subtype)) continue;
      if (!m.user || m.bot_id || m.user === "USLACKBOT" || botIds.has(m.user)) continue;
      if (!peopleById.has(m.user)) {
        // Someone outside users.json: keep them, named from the message if possible.
        const guest = personFrom({
          id: m.user,
          name: m.user_profile?.name ?? `guest-${m.user.slice(-4).toLowerCase()}`,
          profile: m.user_profile,
        });
        people.push(guest);
        peopleById.set(guest.id, guest);
      }
      const t = Math.round(Number.parseFloat(m.ts ?? "") * 1000);
      if (!Number.isFinite(t)) continue;
      const raw = m.text ?? "";
      messages.push({
        t,
        user: m.user,
        channel: channel.id,
        mentions: extractMentions(raw).filter((id) => id !== m.user && peopleById.has(id)),
        text: renderPreview(raw, peopleById, channelsById),
      });
    }
  }

  if (messages.length === 0) {
    throw new Error("No human messages found in this export.");
  }
  messages.sort((a, b) => a.t - b.t);

  // Only keep entities that actually took part.
  const activePeople = new Set<string>();
  const activeChannels = new Set<string>();
  for (const m of messages) {
    activePeople.add(m.user);
    activeChannels.add(m.channel);
    for (const id of m.mentions) activePeople.add(id);
  }

  const first = messages[0].t;
  const last = messages[messages.length - 1].t;
  const start = new Date(first);
  start.setHours(0, 0, 0, 0);
  const end = new Date(last);
  end.setHours(0, 0, 0, 0);

  return {
    label,
    source: "import",
    people: people.filter((p) => activePeople.has(p.id)),
    channels: [...channelsById.values()].filter((c) => activeChannels.has(c.id)),
    messages,
    start: start.getTime(),
    end: end.getTime() + DAY,
  };
};
