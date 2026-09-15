import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMessageSections,
  createMessageGroupingCache,
  extractGroupValues,
} from "../src/utils/messageGrouping.js";

const createMessage = (messageId, timestamp, direction, data) => ({
  messageId,
  timestamp,
  direction,
  type: "message",
  data: JSON.stringify(data),
});

test("groups messages by a JSON field and keeps missing values separate", () => {
  const messages = [
    createMessage("a1", 10, "outgoing", { requestID: "A", eventID: "created" }),
    createMessage("b1", 20, "outgoing", { requestID: "B", eventID: "updated" }),
    createMessage("a2", 30, "incoming", { requestID: "A", eventID: "finished" }),
    createMessage("missing", 40, "incoming", { eventID: "ignored" }),
  ];

  const sections = buildMessageSections({
    sortedMessages: messages,
    groupEnabled: true,
    groupField: "requestID",
    groupValue: "",
    groupDisplayField: "eventID",
    groupSortMode: "firstOutgoing",
    otherTitle: "Other messages",
    missingFieldTitle: "No requestID",
    cache: createMessageGroupingCache(),
  });

  assert.deepEqual(
    sections.map((section) => ({
      id: section.id,
      messageIds: section.messages.map((message) => message.messageId),
      displayValue: section.displayValue,
    })),
    [
      {
        id: "value:requestID:A",
        messageIds: ["a1", "a2"],
        displayValue: "eventID: created, finished",
      },
      {
        id: "value:requestID:B",
        messageIds: ["b1"],
        displayValue: "eventID: updated",
      },
      {
        id: "missing:requestID",
        messageIds: ["missing"],
        displayValue: "eventID: ignored",
      },
    ]
  );
});

test("reuses extracted values until a message payload changes", () => {
  const cache = createMessageGroupingCache();
  const message = createMessage("1", 10, "outgoing", { requestID: "A" });

  const firstResult = extractGroupValues(message, "requestID", cache);
  const cachedResult = extractGroupValues(message, "requestID", cache);

  assert.strictEqual(cachedResult, firstResult);

  message.data = JSON.stringify({ requestID: "B" });
  const updatedResult = extractGroupValues(message, "requestID", cache);

  assert.notStrictEqual(updatedResult, firstResult);
  assert.deepEqual(updatedResult, ["B"]);
});
