import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectedSections,
  collectFieldCandidates,
  createMessageProjectionCache,
  extractMessageField,
  getProjectedMessages,
  getVisibleProjectedMessages,
  parseProjectionPath,
} from "../src/utils/messageProjection.js";
import { filterMessages } from "../src/utils/filterUtils.js";
import { buildMessageSections, createMessageGroupingCache } from "../src/utils/messageGrouping.js";

const message = (data, overrides = {}) => ({ type: "message", data, ...overrides });

const extract = (source, path, cache = createMessageProjectionCache()) => {
  const parsed = parseProjectionPath(path);
  assert.equal(parsed.ok, true, `Expected ${path} to parse`);
  return extractMessageField(source, parsed.tokens, cache, path);
};

test("parses exact dotted, indexed, quoted, and root candidate paths", () => {
  assert.deepEqual(parseProjectionPath('choices[0].message.content'), {
    ok: true,
    tokens: ["choices", 0, "message", "content"],
  });
  assert.deepEqual(parseProjectionPath('a.0.c'), { ok: true, tokens: ["a", 0, "c"] });
  assert.deepEqual(parseProjectionPath('a["key.with.dot"]'), { ok: true, tokens: ["a", "key.with.dot"] });
  assert.deepEqual(parseProjectionPath('["中文.key"]'), { ok: true, tokens: ["中文.key"] });
  assert.deepEqual(parseProjectionPath('[0]'), { ok: true, tokens: [0] });
  assert.equal(parseProjectionPath('payload[*]').ok, false);
  assert.equal(parseProjectionPath('a[01]').ok, false);
  assert.equal(parseProjectionPath('a[9007199254740993]').ok, false);
});

test("extracts values exactly and preserves false, zero, null, empty, and whitespace", () => {
  const source = message(JSON.stringify({ payload: { items: [{ text: "\n  text" }], zero: 0, false: false, nil: null, empty: "", whitespace: " \n" } }));
  assert.equal(extract(source, 'payload.items[0].text').formatted.text, "\n  text");
  assert.equal(extract(source, "payload.zero").formatted.text, "0");
  assert.equal(extract(source, "payload.false").formatted.text, "false");
  assert.equal(extract(source, "payload.nil").formatted.text, "null");
  assert.equal(extract(source, "payload.empty").formatted.isEmptyString, true);
  assert.equal(extract(source, "payload.whitespace").formatted.isWhitespaceOnly, true);
  assert.equal(extract(source, "payload.missing").status, "missing");
});

test("does not read prototype properties or nested JSON strings", () => {
  const payload = Object.create({ inherited: "no" });
  payload.encoded = '{"next":"not parsed"}';
  const source = message(payload);
  assert.equal(extract(source, "inherited").status, "missing");
  assert.equal(extract(source, "encoded.next").status, "missing");
});

test("distinguishes invalid JSON, unsupported data, and system messages", () => {
  assert.equal(extract(message("not json"), "value").status, "invalid-json");
  assert.equal(extract(message(new Uint8Array([1])), "value").status, "unsupported");
  assert.equal(extract({ type: "open", data: "{}" }, "value").status, "not-applicable");
});

test("caches the current path result, invalidates when payload changes, and retains parsed payloads across paths", () => {
  const cache = createMessageProjectionCache();
  const source = message('{"payload":{"first":"A","second":"B"}}');
  const first = extract(source, "payload.first", cache);
  assert.strictEqual(extract(source, "payload.first", cache), first);
  assert.equal(extract(source, "payload.second", cache).formatted.text, "B");
  source.data = '{"payload":{"first":"C"}}';
  const changed = extract(source, "payload.first", cache);
  assert.notStrictEqual(changed, first);
  assert.equal(changed.formatted.text, "C");
});

test("candidate paths round-trip for root, dots, Unicode, arrays, and empty keys", () => {
  const source = message({
    "": "empty-key",
    "中文.key": "unicode",
    payload: { "key.with.dot": "dot", values: ["first"] },
  });
  const candidates = collectFieldCandidates([source]);
  const paths = candidates.map((candidate) => candidate.path);
  assert.deepEqual(paths, ['[""]', '["中文.key"]', 'payload["key.with.dot"]', "payload.values[0]"]);
  for (const path of paths) assert.equal(extract(source, path).status, "matched");
});

test("field projection works when Object.hasOwn is unavailable", () => {
  const originalHasOwn = Object.hasOwn;
  Object.hasOwn = undefined;
  try {
    const source = message({ payload: { value: "visible" } });
    assert.equal(extract(source, "payload.value").status, "matched");
    assert.deepEqual(collectFieldCandidates([source]).map((candidate) => candidate.path), ["payload.value"]);
  } finally {
    Object.hasOwn = originalHasOwn;
  }
});

test("candidate traversal stops at maxNodes without wide-object expansion", () => {
  let reads = 0;
  const wide = {};
  for (let index = 0; index < 100; index += 1) {
    Object.defineProperty(wide, `key${index}`, { enumerable: true, get() { reads += 1; return index; } });
  }
  const candidates = collectFieldCandidates([message(wide)], { maxMessages: 1, maxNodes: 7, maxCandidates: 200 });
  assert.equal(candidates.length, 7);
  assert.equal(reads, 7);
});

test("candidate traversal stops after maxMessages", () => {
  let excludedMessageReads = 0;
  const excludedMessage = {};
  Object.defineProperty(excludedMessage, "third", {
    enumerable: true,
    get() {
      excludedMessageReads += 1;
      return "third";
    },
  });
  const candidates = collectFieldCandidates([
    message({ first: "first" }),
    message({ second: "second" }),
    message(excludedMessage),
  ], { maxMessages: 2, maxNodes: 10, maxCandidates: 10 });

  assert.deepEqual(candidates.map((candidate) => candidate.path), ["first", "second"]);
  assert.equal(excludedMessageReads, 0);
});

test("candidate traversal stops at maxCandidates without reading remaining fields", () => {
  let reads = 0;
  const wide = {};
  for (let index = 0; index < 100; index += 1) {
    Object.defineProperty(wide, `key${index}`, { enumerable: true, get() { reads += 1; return index; } });
  }

  const candidates = collectFieldCandidates([message(wide)], { maxMessages: 1, maxNodes: 100, maxCandidates: 3 });

  assert.equal(candidates.length, 3);
  assert.equal(reads, 3);
});

test("projection keeps original groups, hides empty or missing rows, and keyboard order follows expanded rows", () => {
  const sections = [
    {
      id: "group:a",
      isGrouped: true,
      messages: [
        message('{"payload":{"content":"first"}}', { messageId: "a-first" }),
        message('{"payload":{"content":""}}', { messageId: "a-empty" }),
      ],
    },
    {
      id: "group:b",
      isGrouped: true,
      messages: [
        message('{"payload":{"other":"missing"}}', { messageId: "b-missing" }),
        message('{"payload":{"content":"second"}}', { messageId: "b-second" }),
      ],
    },
  ];
  const parsed = parseProjectionPath("payload.content");
  const config = { mode: "field", path: "payload.content", hideMissing: true, hideEmpty: true };
  const projected = buildProjectedSections(sections, config, parsed.tokens, createMessageProjectionCache());
  assert.deepEqual(projected.map((section) => ({
    id: section.id,
    sourceCount: section.messages.length,
    visibleIds: section.projectedMessages.map(({ message: source }) => source.messageId),
  })), [
    { id: "group:a", sourceCount: 2, visibleIds: ["a-first"] },
    { id: "group:b", sourceCount: 2, visibleIds: ["b-second"] },
  ]);
  assert.deepEqual(
    getVisibleProjectedMessages(projected, { "group:a": true }).map((source) => source.messageId),
    ["b-second"]
  );
  assert.deepEqual(
    getProjectedMessages(projected).map((source) => source.messageId),
    ["a-first", "b-second"]
  );

  const allRows = buildProjectedSections(
    sections,
    { ...config, hideMissing: false, hideEmpty: false },
    parsed.tokens,
    createMessageProjectionCache()
  );
  assert.deepEqual(getVisibleProjectedMessages(allRows, {}).map((source) => source.messageId), [
    "a-first", "a-empty", "b-missing", "b-second",
  ]);

  const clearedProjection = buildProjectedSections(
    sections,
    { ...config, mode: "raw", path: "" },
    undefined,
    createMessageProjectionCache()
  );
  assert.deepEqual(getVisibleProjectedMessages(clearedProjection, {}).map((source) => source.messageId), [
    "a-first", "a-empty", "b-missing", "b-second",
  ]);
});

test("original filtering and grouping precede projected visibility", () => {
  const messages = [
    message('{"requestID":"A","payload":{"content":"sent"}}', { messageId: "sent", direction: "outgoing", timestamp: 1 }),
    message('{"requestID":"B","payload":{"content":""}}', { messageId: "empty", direction: "incoming", timestamp: 2 }),
    message('{"requestID":"A","payload":{"content":"received"}}', { messageId: "received", direction: "incoming", timestamp: 3 }),
  ];
  const filtered = filterMessages(messages, { direction: "incoming" });
  const sections = buildMessageSections({
    sortedMessages: filtered,
    groupEnabled: true,
    groupField: "requestID",
    groupValue: "",
    groupDisplayField: "",
    groupSortMode: "firstMessage",
    otherTitle: "Other",
    missingFieldTitle: "Missing",
    cache: createMessageGroupingCache(),
  });
  const parsed = parseProjectionPath("payload.content");
  const projected = buildProjectedSections(
    sections,
    { mode: "field", path: "payload.content", hideMissing: true, hideEmpty: true },
    parsed.tokens,
    createMessageProjectionCache()
  );
  assert.deepEqual(projected.map((section) => section.id), ["value:requestID:A"]);
  assert.deepEqual(getVisibleProjectedMessages(projected, {}).map((source) => source.messageId), ["received"]);
});

test("cached payload parsing is reused for path changes and only parses an appended frame", () => {
  const cache = createMessageProjectionCache();
  const messages = Array.from({ length: 40 }, (_, index) => message(`{"payload":{"value":${index},"other":true}}`));
  const valuePath = parseProjectionPath("payload.value");
  const otherPath = parseProjectionPath("payload.other");
  const originalParse = JSON.parse;
  let parseCount = 0;
  JSON.parse = (...args) => { parseCount += 1; return originalParse(...args); };
  try {
    messages.forEach((source) => extractMessageField(source, valuePath.tokens, cache, "payload.value"));
    assert.equal(parseCount, 40);
    parseCount = 0;
    messages.forEach((source) => extractMessageField(source, otherPath.tokens, cache, "payload.other"));
    assert.equal(parseCount, 0);
    const appended = message('{"payload":{"value":40,"other":true}}');
    parseCount = 0;
    [...messages, appended].forEach((source) => extractMessageField(source, otherPath.tokens, cache, "payload.other"));
    assert.equal(parseCount, 1);
  } finally {
    JSON.parse = originalParse;
  }
});

test("same projected values from different frames remain separate and cached extraction scales to retained messages", () => {
  const cache = createMessageProjectionCache();
  const messages = Array.from({ length: 20000 }, (_, index) => message(`{"payload":{"value":"same"},"index":${index}}`, { messageId: String(index) }));
  const parsed = parseProjectionPath("payload.value");
  const startedAt = performance.now();
  const values = messages.map((source) => extractMessageField(source, parsed.tokens, cache, "payload.value"));
  const firstPassMs = performance.now() - startedAt;
  const appended = message('{"payload":{"value":"same"}}', { messageId: "new" });
  const appendStartedAt = performance.now();
  const appendedResult = extractMessageField(appended, parsed.tokens, cache, "payload.value");
  const appendMs = performance.now() - appendStartedAt;
  assert.equal(values.length, 20000);
  assert.notStrictEqual(values[0], values[1]);
  assert.equal(appendedResult.formatted.text, "same");
  // Timing is intentionally not thresholded because extension hosts vary widely.
  assert.ok(Number.isFinite(firstPassMs) && Number.isFinite(appendMs));
});
