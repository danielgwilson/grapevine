import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from any static host or subfolder.
  base: "./",
  test: {
    environment: "node",
  },
});
