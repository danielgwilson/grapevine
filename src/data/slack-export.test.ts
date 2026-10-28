import { describe, expect, it } from "vitest";

import { buildDemoExport, loadDemoDataset } from "./demo";
import { type ExportFiles, extractMentions, parseSlackExport } from "./slack-export";

const fixture = (prefix = ""): ExportFiles =>
  new Map([
    [
      `${prefix}users.json`,
      JSON.stringify([
        { id: "U1", name: "ana", profile: { real_name: "Ana Lima", display_name: "ana" } },
        { id: "U2", name: "bo", profile: { real_name: "Bo Chen", display_name: "" } },
        { id: "B1", name: "deploybot", is_bot: true },
      ]),
    ],
    [`${prefix}channels.json`, JSON.stringify([{ id: "C1", name: "general" }])],
    [`${prefix}groups.json`, JSON.stringify([{ id: "G1", name: "secret-plans" }])],
    [`${prefix}dms.json`, JSON.stringify([{ id: "D1", members: ["U1", "U2"] }])],
    [
      `${prefix}general/2025-01-02.json`,
      JSON.stringify([
        {
          type: "message",
          user: "U1",
          text: "hi <@U2> see <#C1|general> &amp; <https://x.com|this>",
          ts: "1735812000.000100",
        },
        {
          type: "message",
          subtype: "channel_join",
          user: "U2",
          text: "<@U2> has joined",
          ts: "1735812001.0",
        },
        {
          type: "message",
          subtype: "bot_message",
          bot_id: "B1",
          text: "deployed",
          ts: "1735812002.0",
        },
        { type: "message", user: "U2", text: "<!here> lunch", ts: "1735812003.0" },
      ]),
    ],
    [
      `${prefix}secret-plans/2025-01-01.json`,
      JSON.stringify([{ type: "message", user: "U2", text: "shh", ts: "1735725600.0" }]),
    ],
    [
      `${prefix}D1/2025-01-03.json`,
      JSON.stringify([{ type: "message", user: "U1", text: "dm", ts: "1735898400.0" }]),
    ],
    [`${prefix}general/not-json.json`, "{broken"],
  ]);

describe("parseSlackExport", () => {
  it("parses channels, private groups and DMs, skipping bots and system messages", () => {
    const ds = parseSlackExport(fixture(), "test");
    expect(ds.messages.map((m) => m.text)).toEqual([
      "shh",
      "hi @Bo see #general & this",
      "@here lunch",
      "dm",
    ]);
    expect(ds.channels.map((c) => [c.name, c.kind]).sort()).toEqual([
      ["#general", "public"],
      ["#secret-plans", "private"],
      ["dm: ana + Bo", "dm"],
    ]);
    expect(ds.people.map((p) => p.name).sort()).toEqual(["Bo", "ana"]);
    expect(ds.messages[1].mentions).toEqual(["U2"]);
  });

  it("is sorted and spans whole local days", () => {
    const ds = parseSlackExport(fixture(), "test");
    for (let i = 1; i < ds.messages.length; i += 1)
      expect(ds.messages[i].t).toBeGreaterThanOrEqual(ds.messages[i - 1].t);
    expect(ds.start).toBeLessThanOrEqual(ds.messages[0].t);
    expect(ds.end).toBeGreaterThan(ds.messages[ds.messages.length - 1].t);
    expect(new Date(ds.start).getHours()).toBe(0);
  });

  it("keeps people missing from users.json, but not known bots", () => {
    const files = fixture();
    files.set(
      "general/2025-01-04.json",
      JSON.stringify([
        {
          type: "message",
          user: "UX9Z",
          text: "hello from a partner",
          ts: "1735984800.0",
          user_profile: { real_name: "Pat Guest" },
        },
        { type: "message", user: "UNOPROFILE", text: "no profile", ts: "1735984801.0" },
        { type: "message", user: "B1", text: "bot posting as a user", ts: "1735984802.0" },
      ]),
    );
    const ds = parseSlackExport(files, "test");
    expect(ds.people.map((p) => p.fullName)).toEqual(
      expect.arrayContaining(["Pat Guest", "guest-file"]),
    );
    expect(ds.messages.some((m) => m.user === "B1")).toBe(false);
  });

  it("resolves mentions of guests even when the mention is read first", () => {
    const files = fixture();
    files.set(
      "general/2025-01-01.json",
      JSON.stringify([{ type: "message", user: "U1", text: "hi <@UGUEST>", ts: "1735725000.0" }]),
    );
    files.set(
      "general/2025-01-05.json",
      JSON.stringify([
        {
          type: "message",
          user: "UGUEST",
          text: "hello",
          ts: "1736071200.0",
          user_profile: { real_name: "Remy Partner" },
        },
      ]),
    );
    const ds = parseSlackExport(files, "test");
    const mention = ds.messages.find((m) => m.text.startsWith("hi @"));
    expect(mention?.mentions).toEqual(["UGUEST"]);
    expect(mention?.text).toBe("hi @Remy");
  });

  it("covers the whole last day, even a 25-hour daylight-saving day", () => {
    const files = fixture();
    const late = new Date(2025, 10, 2, 23, 30).getTime();
    files.set(
      "general/2025-11-02.json",
      JSON.stringify([{ type: "message", user: "U1", text: "late", ts: String(late / 1000) }]),
    );
    const ds = parseSlackExport(files, "test");
    expect(ds.end).toBeGreaterThan(late);
    expect(new Date(ds.end).getHours()).toBe(0);
  });

  it("explains malformed list files in plain words", () => {
    const files = fixture();
    files.set("users.json", JSON.stringify({ not: "a list" }));
    expect(() => parseSlackExport(files, "x")).toThrow("users.json in this export is not a list.");
  });

  it("handles exports re-zipped inside a folder", () => {
    expect(parseSlackExport(fixture("My Workspace Export/"), "x").messages).toHaveLength(4);
  });

  it("rejects things that are not exports", () => {
    expect(() => parseSlackExport(new Map([["readme.txt", "hi"]]), "x")).toThrow(/users\.json/);
  });

  it("extracts unique mentions, including labelled ones", () => {
    expect(extractMentions("<@U1> <@U2|bo> <@U1>")).toEqual(["U1", "U2"]);
  });
});

describe("demo workspace", () => {
  const start = new Date(2025, 7, 1);

  it("is deterministic for a seed", () => {
    const a = buildDemoExport({ seed: 3, start });
    const b = buildDemoExport({ seed: 3, start });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("goes through the real parser and looks like a month of work", () => {
    const ds = loadDemoDataset({ start });
    expect(ds.source).toBe("demo");
    expect(ds.people.length).toBe(32);
    expect(ds.channels.length).toBe(15);
    expect(ds.messages.length).toBeGreaterThan(5000);
    expect(
      ds.messages.filter((m) => m.mentions.length > 0).length / ds.messages.length,
    ).toBeGreaterThan(0.15);
  });
});
