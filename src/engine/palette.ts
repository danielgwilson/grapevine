export type PaletteId = "moonlight" | "tide" | "spectrum";

export type Palette = {
  id: PaletteId;
  label: string;
  /** Color for a channel (and the people whose home it is) by volume rank. */
  hue: (rank: number) => string;
  /** Comet tails for ordinary messages. */
  flight: (hue: string) => string;
};

// Moonlight: one cool silver for everything; only motion and mentions carry color.
const SILVER = ["#d6deec", "#c3cde0", "#b2bdd3", "#a4b0c8"];
// Tide: a narrow band of blues, light to deep.
const TIDE = [
  "#70d8fa",
  "#8ea8ff",
  "#a6d7ff",
  "#5fb3e6",
  "#b4c4ff",
  "#7fc8e8",
  "#6f93f0",
  "#c9e6ff",
];
// Spectrum: light, low-saturation hues that read as light on near-black.
const SPECTRUM = [
  "#70d8fa",
  "#8ea8ff",
  "#9be3c6",
  "#f6a6b8",
  "#c3b5ff",
  "#7fc8e8",
  "#e7c9a4",
  "#a6d7ff",
  "#b3e09a",
  "#f2b48c",
  "#9fb4d6",
  "#d9a6e8",
];

export const PALETTES: Palette[] = [
  {
    id: "moonlight",
    label: "mono",
    hue: (rank) => SILVER[rank % SILVER.length],
    flight: () => "#9fdcff",
  },
  { id: "tide", label: "tide", hue: (rank) => TIDE[rank % TIDE.length], flight: (hue) => hue },
  {
    id: "spectrum",
    label: "spectrum",
    hue: (rank) => SPECTRUM[rank % SPECTRUM.length],
    flight: (hue) => hue,
  },
];

export const NEUTRAL = "#8b93a7";
export const MENTION = "#fad586"; // sand

export const paletteById = (id: PaletteId) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** Parse #rrggbb into rgba() with alpha. */
export const withAlpha = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, alpha).toFixed(3)})`;
};
