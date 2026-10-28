const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });

export const fmtDay = (t: number) => dayFmt.format(t);
export const fmtTime = (t: number) => timeFmt.format(t);
export const fmtShort = (t: number) => shortFmt.format(t);
export const fmtMonth = (t: number) => monthFmt.format(t);
export const fmtCount = (n: number) => n.toLocaleString();
