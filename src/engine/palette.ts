// Channel hues, from Radix Colors dark scales (step 10 unless noted), ordered
// so the busiest channels get the most separable colors.
const CHANNEL_HUES = [
  "#3b9eff", // blue 10
  "#3dd68c", // green 11-ish (jade/grass family)
  "#ffc53d", // amber 9
  "#ff977d", // tomato 11
  "#4ccce6", // cyan 11
  "#9eb1ff", // indigo 11
  "#ff8dcc", // pink 11
  "#ffa057", // orange 11
  "#bde56c", // lime 11
  "#7ce2fe", // sky 9
  "#e5484d", // red 9
  "#d19dff", // purple 11
  "#0bd8b6", // teal-mint 11
  "#ffe629", // yellow 9
];

export const NEUTRAL = "#8b8d98"; // slate 9 (dark)
export const MENTION = "#ffc53d"; // amber 9

export const colorForChannel = (rank: number) => CHANNEL_HUES[rank % CHANNEL_HUES.length];

/** Parse #rrggbb into rgba() with alpha. */
export const withAlpha = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
};
