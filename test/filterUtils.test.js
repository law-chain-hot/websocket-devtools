import assert from "node:assert/strict";
import test from "node:test";

import {
  filterConnections,
  filterMessages,
} from "../src/utils/filterUtils.js";

test("filters messages with a regular expression", () => {
  const messages = [
    { data: "hello websocket", direction: "incoming", timestamp: 1 },
    { data: "plain text", direction: "incoming", timestamp: 2 },
  ];

  const result = filterMessages(messages, { text: "/websocket/i" });

  assert.deepEqual(result, [messages[0]]);
});

test("evaluates a global regular expression independently for every connection", () => {
  const connections = [
    { id: "first", url: "wss://example.test/socket" },
    { id: "second", url: "wss://example.test/socket" },
  ];

  const result = filterConnections(connections, { text: "/example/g" });

  assert.deepEqual(result, connections);
});

test("evaluates a sticky regular expression independently for every connection", () => {
  const connections = [
    { id: "first", url: "wss://example.test/socket" },
    { id: "second", url: "wss://example.test/socket" },
  ];

  const result = filterConnections(connections, { text: "/wss/y" });

  assert.deepEqual(result, connections);
});
