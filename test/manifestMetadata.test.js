import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the action tooltip aligned with the extension name", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
  );

  assert.ok(
    manifest.action.default_title.startsWith(manifest.name),
    `Expected action title to start with ${JSON.stringify(manifest.name)}`,
  );
});
