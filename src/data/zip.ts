import { unzip } from "fflate";

import { type ExportFiles, parseSlackExport } from "./slack-export";
import type { Dataset } from "./types";

const decoder = new TextDecoder();

/** Read a Slack export .zip in the browser. Nothing is uploaded anywhere. */
export const readExportZip = async (file: File): Promise<Dataset> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      bytes,
      // Skip attachments and anything else that is not message JSON.
      { filter: (f) => f.name.endsWith(".json") && !f.name.startsWith("__MACOSX") },
      (err, data) =>
        err ? reject(new Error(`Could not open zip: ${err.message}`)) : resolve(data),
    );
  });
  const files: ExportFiles = new Map();
  for (const [path, data] of Object.entries(entries)) files.set(path, decoder.decode(data));
  return parseSlackExport(files, file.name.replace(/\.zip$/i, ""));
};
