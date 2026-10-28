import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { loadDemoDataset } from "./data/demo";
import type { Dataset } from "./data/types";
import { readExportZip } from "./data/zip";
import { MEMORY, Player, SPEEDS } from "./engine/player";
import { DAY, HOUR } from "./engine/replay";
import { fmtCount, fmtDay, fmtTime } from "./ui/format";
import { GraphCanvas } from "./ui/GraphCanvas";
import { Rail } from "./ui/Rail";
import { Timeline } from "./ui/Timeline";

type Status = { kind: "loading" | "error"; text: string } | null;

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { label: string }[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <div className="segmented">
      <span className="eyebrow inline">{label}</span>
      {options.map((o, i) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={i === value}
          className={i === value ? "on" : undefined}
          onClick={() => onChange(i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [dataset, setDataset] = useState<Dataset>(() => loadDemoDataset());
  const player = useMemo(() => new Player(dataset), [dataset]);
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async (file: File) => {
    setStatus({ kind: "loading", text: `Reading ${file.name}…` });
    try {
      setDataset(await readExportZip(file));
      setStatus(null);
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const step = e.shiftKey ? DAY : HOUR;
      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          player.step(step);
          break;
        case "ArrowLeft":
          e.preventDefault();
          player.step(-step);
          break;
        case "]":
          player.setSpeed(player.speed + 1);
          break;
        case "[":
          player.setSpeed(player.speed - 1);
          break;
        case "f":
          player.setFollow(true);
          break;
        case "Escape":
          if (player.pinned) player.pin(player.pinned);
          break;
        case "Home":
          player.seek(dataset.start);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, dataset]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void load(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [load]);

  return (
    <div className="app">
      <main className="stage">
        <GraphCanvas player={player} />
        <header className="hud">
          <p className="brand">
            <span className="mark" aria-hidden="true" />
            murmuration
            <span className="source">
              {dataset.source === "demo"
                ? "demo · fictional company"
                : "your export · stays on this computer"}
            </span>
          </p>
          <h1 className="clock">
            <span className="clock-day">{fmtDay(snap.t)}</span>
            <span className="clock-time">{fmtTime(snap.t)}</span>
          </h1>
          <p className="dataset">
            {dataset.label} · {fmtCount(dataset.people.length)} people ·{" "}
            {fmtCount(dataset.channels.length)} channels · {fmtCount(dataset.messages.length)}{" "}
            messages
          </p>
        </header>
        {snap.pulse.sent === 0 ? (
          <p className="empty">
            Nobody has said anything yet. Press <kbd>space</kbd> to play.
          </p>
        ) : null}
        <ul className="legend" aria-label="Legend">
          <li>
            <span className="key-dot" /> person
          </li>
          <li>
            <span className="key-ring" /> channel
          </li>
          <li>
            <span className="key-mention" /> @mention
          </li>
          <li>size = recent activity</li>
        </ul>
        {!snap.follow ? (
          <button type="button" className="refit" onClick={() => player.setFollow(true)}>
            Re-center <kbd>F</kbd>
          </button>
        ) : null}
      </main>

      <Rail player={player} snap={snap} />

      <footer className="deck">
        <div className="transport">
          <button
            type="button"
            className="play"
            onClick={() => player.toggle()}
            aria-label={snap.playing ? "Pause" : "Play"}
          >
            {snap.playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
                <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.6v10.8a.5.5 0 0 0 .77.42l8.4-5.4a.5.5 0 0 0 0-.84l-8.4-5.4a.5.5 0 0 0-.77.42Z" />
              </svg>
            )}
          </button>
          <Segmented
            label="per second"
            options={SPEEDS}
            value={snap.speed}
            onChange={(i) => player.setSpeed(i)}
          />
          <Segmented
            label="memory"
            options={MEMORY}
            value={snap.memory}
            onChange={(i) => player.setMemory(i)}
          />
          <div className="spacer" />
          {status ? <p className={`status ${status.kind}`}>{status.text}</p> : null}
          {dataset.source === "import" ? (
            <button
              type="button"
              className="btn quiet"
              onClick={() => setDataset(loadDemoDataset())}
            >
              Back to demo
            </button>
          ) : null}
          <label className="btn">
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void load(file);
                e.target.value = "";
              }}
            />
            Open Slack export
          </label>
          <p className="keys">
            <kbd>space</kbd> play <kbd>←</kbd>
            <kbd>→</kbd> hour <kbd>⇧</kbd> day <kbd>[</kbd>
            <kbd>]</kbd> speed
          </p>
        </div>
        <Timeline player={player} t={snap.t} />
      </footer>

      {dragging ? (
        <div className="dropzone">
          <p className="drop-title">Drop a Slack export .zip</p>
          <p className="drop-sub">It is read in this browser tab. Nothing is uploaded.</p>
        </div>
      ) : null}
    </div>
  );
}
