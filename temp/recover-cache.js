const fs = require("fs");
const path = require("path");

const corruptedPath = path.join(
  __dirname,
  "..",
  "data",
  "nhl-player-stats.json.corrupted-2026-05-26T00-10-29-854Z",
);
const currentPath = path.join(__dirname, "..", "data", "nhl-player-stats.json");

let raw = fs.readFileSync(corruptedPath, "utf8");
// Strip the literal backslash-n that my injection script accidentally appended,
// plus any real whitespace, until the file ends with the JSON closing brace.
raw = raw.replace(/[\s\\n]+$/g, "");
const lastBrace = raw.lastIndexOf("}");
raw = raw.slice(0, lastBrace + 1);

const recovered = JSON.parse(raw);
const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));

console.log("recovered entries:", Object.keys(recovered.entries).length);
console.log("current entries:", Object.keys(current.entries).length);

// Merge: prefer the most recent entry for each id (compare refreshedAt).
const mergedEntries = { ...recovered.entries };
for (const [id, currentEntry] of Object.entries(current.entries)) {
  const existing = mergedEntries[id];
  if (!existing) {
    mergedEntries[id] = currentEntry;
    continue;
  }
  const existingTime = Date.parse(existing.refreshedAt || "") || 0;
  const currentTime = Date.parse(currentEntry.refreshedAt || "") || 0;
  if (currentTime >= existingTime) {
    mergedEntries[id] = currentEntry;
  }
}

const merged = {
  importedAt: new Date().toISOString(),
  refreshIntervalMs: current.refreshIntervalMs || recovered.refreshIntervalMs,
  entries: mergedEntries,
};

console.log("merged entries:", Object.keys(merged.entries).length);
console.log(
  "merged contains 4911:",
  !!merged.entries["pho-4911"],
  "10730:",
  !!merged.entries["pho-10730"],
);

fs.writeFileSync(currentPath, JSON.stringify(merged, null, 2) + "\n");
const verified = JSON.parse(fs.readFileSync(currentPath, "utf8"));
console.log("parse verification OK, entries:", Object.keys(verified.entries).length);
