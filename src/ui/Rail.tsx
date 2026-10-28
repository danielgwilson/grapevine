import type { Message } from "../data/types";
import type { Player, Snapshot } from "../engine/player";
import { fmtCount, fmtShort, fmtTime } from "./format";

function MessageRow({
  player,
  m,
  showChannel = true,
}: {
  player: Player;
  m: Message;
  showChannel?: boolean;
}) {
  const person = player.replay.node("person", m.user);
  const channel = player.replay.node("channel", m.channel);
  return (
    <li className="msg">
      <div className="msg-meta">
        <span className="dot" style={{ background: person?.color }} />
        <button type="button" className="link" onClick={() => person && player.pin(person.key)}>
          {person?.label ?? "someone"}
        </button>
        {showChannel && channel ? (
          <button type="button" className="link quiet" onClick={() => player.pin(channel.key)}>
            {channel.label}
          </button>
        ) : null}
        <time>
          {fmtShort(m.t)} {fmtTime(m.t)}
        </time>
      </div>
      <p className="msg-text">{m.text || "(attachment)"}</p>
    </li>
  );
}

export function Rail({ player, snap }: { player: Player; snap: Snapshot }) {
  const { pulse, focus } = snap;
  const maxRow = (items: { value: number }[]) => Math.max(1, ...items.map((i) => i.value));

  return (
    <aside className="rail">
      <section className="rail-section">
        <h2 className="eyebrow">Right now</h2>
        <dl className="stats">
          <div>
            <dt>last hour</dt>
            <dd>{fmtCount(pulse.lastHour)}</dd>
          </div>
          <div>
            <dt>voices · 24h</dt>
            <dd>{fmtCount(pulse.voices24h)}</dd>
          </div>
          <div>
            <dt>sent so far</dt>
            <dd>{fmtCount(pulse.sent)}</dd>
          </div>
        </dl>
        <p className="hottest">
          <span className="eyebrow inline">busiest · 3h</span> {pulse.hottest ?? "quiet"}
        </p>
      </section>

      <section className="rail-section focus">
        <h2 className="eyebrow">
          {focus ? (snap.pinned ? "Pinned" : "Hovering") : "Focus"}
          {snap.pinned ? (
            <button
              type="button"
              className="link quiet unpin"
              onClick={() => player.pin(snap.pinned)}
            >
              clear
            </button>
          ) : null}
        </h2>
        {focus ? (
          <>
            <div className="focus-head">
              <span
                className={focus.kind === "channel" ? "swatch ring" : "swatch"}
                style={
                  focus.kind === "channel"
                    ? { borderColor: focus.color }
                    : { background: focus.color }
                }
              />
              <div>
                <h3>{focus.label}</h3>
                {focus.subtitle ? <p className="sub">{focus.subtitle}</p> : null}
              </div>
              <strong className="focus-total">
                {fmtCount(focus.total)}
                <span>{focus.kind === "person" ? "sent" : "msgs"}</span>
              </strong>
            </div>
            {focus.rows.map((row) => {
              const max = maxRow(row.items);
              return (
                <div key={row.title} className="bars-list">
                  <h4 className="eyebrow small">{row.title}</h4>
                  <ul>
                    {row.items.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="bar-row"
                          onClick={() => player.pin(item.key)}
                        >
                          <span className="bar-label">{item.label}</span>
                          <span className="bar-track">
                            <span
                              className="bar-fill"
                              style={{
                                width: `${(item.value / max) * 100}%`,
                                background: item.color,
                              }}
                            />
                          </span>
                          <span className="bar-value">{fmtCount(item.value)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {focus.messages.length > 0 ? (
              <ul className="feed compact">
                {focus.messages.map((m) => (
                  <MessageRow
                    key={`${m.t}${m.user}`}
                    player={player}
                    m={m}
                    showChannel={focus.kind === "person"}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="hint">Hover a dot or ring to see who it is. Click to pin it.</p>
        )}
      </section>

      <section className="rail-section feed-section">
        <h2 className="eyebrow">Latest messages</h2>
        <ul className="feed">
          {snap.feed.map((m) => (
            <MessageRow key={`${m.t}${m.user}${m.channel}`} player={player} m={m} />
          ))}
        </ul>
      </section>
    </aside>
  );
}
