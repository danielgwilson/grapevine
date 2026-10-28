// Light, low-saturation hues that read as light on a near-black field rather
// than as flat fills. Ordered so the busiest channels get the most separable.
const CHANNEL_HUES = [
  "#70d8fa", // sky
  "#8ea8ff", // periwinkle
  "#9be3c6", // mint
  "#f6a6b8", // rose
  "#c3b5ff", // lilac
  "#7fc8e8", // glacier
  "#e7c9a4", // wheat
  "#a6d7ff", // ice
  "#b3e09a", // sage
  "#f2b48c", // apricot
  "#9fb4d6", // slate blue
  "#d9a6e8", // orchid
];

export const NEUTRAL = "#8b93a7";
export const MENTION = "#fad586"; // sand

export const colorForChannel = (rank: number) => CHANNEL_HUES[rank % CHANNEL_HUES.length];

/** Parse #rrggbb into rgba() with alpha. */
export const withAlpha = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
};
