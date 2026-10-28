export type Person = {
  id: string;
  /** Short label drawn on the graph (display name, else real name, else handle). */
  name: string;
  /** Longer label for the focus panel. */
  fullName: string;
  title?: string;
  /** Profile photo URL (relative for the demo, Slack's image CDN for imports). */
  avatar?: string;
};

export type ChannelKind = "public" | "private" | "group-dm" | "dm";

export type Channel = {
  id: string;
  /** Includes the leading # for public/private channels. */
  name: string;
  kind: ChannelKind;
};

export type Message = {
  /** Epoch milliseconds. */
  t: number;
  user: string;
  channel: string;
  mentions: string[];
  /** Plain-text preview with mentions resolved, max 180 chars. */
  text: string;
};

export type Dataset = {
  label: string;
  source: "demo" | "import";
  people: Person[];
  channels: Channel[];
  /** Sorted by t ascending. */
  messages: Message[];
  start: number;
  end: number;
};
