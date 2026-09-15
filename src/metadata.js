import { readFile } from "node:fs/promises";

export async function loadMetadata(options) {
  if (options.metadata !== undefined && options.metadataFile !== undefined) {
    throw new Error("Use either --metadata or --metadata-file, not both.");
  }
  const raw = options.metadataFile !== undefined
    ? await readFile(options.metadataFile, "utf8") : options.metadata;
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Metadata must be a JSON object.");
  }
  if (Object.keys(value).length > 50 || Buffer.byteLength(JSON.stringify(value), "utf8") > 16384) {
    throw new Error("Metadata supports at most 50 entries and 16 KB of JSON.");
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim() || key.length > 100 || key === "__proto__") {
      throw new Error("Metadata keys must contain 1-100 characters and cannot be __proto__.");
    }
    if (!(typeof item === "string" && item.length <= 4000) &&
        !(typeof item === "number" && Number.isFinite(item)) && typeof item !== "boolean") {
      throw new Error("Metadata values must be strings (up to 4000 characters), finite numbers, or booleans.");
    }
  }
  return value;
}
