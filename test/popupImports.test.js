import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as lucideIcons from "lucide-react";

test("popup only imports icons exported by lucide-react", async () => {
  const popupSource = await readFile(
    new URL("../src/popup/popup.jsx", import.meta.url),
    "utf8",
  );
  const lucideImport = popupSource.match(
    /import\s*{([^}]+)}\s*from\s*["']lucide-react["'];/,
  );

  assert.ok(lucideImport, "popup should import its icons from lucide-react");

  const importedIcons = lucideImport[1]
    .split(",")
    .map((iconName) => iconName.trim().split(/\s+as\s+/)[0]);

  for (const iconName of importedIcons) {
    assert.ok(
      Object.hasOwn(lucideIcons, iconName),
      `lucide-react does not export ${iconName}`,
    );
  }
});
