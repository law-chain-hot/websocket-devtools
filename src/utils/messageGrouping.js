const createCacheEntry = (message) => {
  const candidateData = [message.data, message.protobufDecoded].filter(
    (candidate) => candidate !== undefined && candidate !== null
  );

  return {
    data: message.data,
    protobufDecoded: message.protobufDecoded,
    type: message.type,
    parsedCandidates: candidateData.map(safeParseJson),
    textData: candidateData
      .filter((candidate) => typeof candidate === "string")
      .join("\n"),
    valuesByField: new Map(),
  };
};

const getCacheEntry = (message, cache) => {
  if (!cache || !message || typeof message !== "object") {
    return createCacheEntry(message);
  }

  const cachedEntry = cache.get(message);
  if (
    cachedEntry &&
    cachedEntry.data === message.data &&
    cachedEntry.protobufDecoded === message.protobufDecoded &&
    cachedEntry.type === message.type
  ) {
    return cachedEntry;
  }

  const nextEntry = createCacheEntry(message);
  cache.set(message, nextEntry);
  return nextEntry;
};

const safeParseJson = (value) => {
  if (typeof value !== "string") {
    return value && typeof value === "object" ? value : null;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
};

const getValueByPath = (source, path) => {
  if (!source || typeof source !== "object" || !path) return undefined;

  return path.split(".").reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
};

const findValuesByKey = (source, targetKey) => {
  const values = [];
  const normalizedTargetKey = targetKey.toLowerCase();

  const visit = (node) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    Object.entries(node).forEach(([key, value]) => {
      if (key.toLowerCase() === normalizedTargetKey) {
        values.push(value);
      }
      visit(value);
    });
  };

  visit(source);
  return values;
};

const normalizeGroupValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
};

const escapeRegExp = (value) => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Cache entries disappear automatically when their message objects are released.
export const createMessageGroupingCache = () => new WeakMap();

export const extractGroupValues = (message, fieldName, cache) => {
  if (!fieldName || !message || message.type !== "message") return [];

  const cacheEntry = getCacheEntry(message, cache);
  if (cacheEntry.valuesByField.has(fieldName)) {
    return cacheEntry.valuesByField.get(fieldName);
  }

  let values = [];

  for (const parsed of cacheEntry.parsedCandidates) {
    if (!parsed) continue;

    const directValue = getValueByPath(parsed, fieldName);
    if (directValue !== undefined) {
      values = [normalizeGroupValue(directValue)];
      break;
    }

    if (!fieldName.includes(".")) {
      const recursiveValues = findValuesByKey(parsed, fieldName);
      if (recursiveValues.length > 0) {
        values = recursiveValues.map(normalizeGroupValue);
        break;
      }
    }
  }

  if (values.length === 0 && cacheEntry.textData) {
    const fieldPattern = escapeRegExp(fieldName);
    const quotedStringValuePattern = new RegExp(
      `"${fieldPattern}"\\s*:\\s*"([^"]*)"`,
      "i"
    );
    const primitiveValuePattern = new RegExp(
      `"${fieldPattern}"\\s*:\\s*([^,}\\]\\s]+)`,
      "i"
    );
    const match =
      cacheEntry.textData.match(quotedStringValuePattern) ||
      cacheEntry.textData.match(primitiveValuePattern);

    values = match ? [match[1]] : [];
  }

  cacheEntry.valuesByField.set(fieldName, values);
  return values;
};

const getGroupDisplayValue = (messages, displayField, cache) => {
  const trimmedDisplayField = displayField.trim();
  if (!trimmedDisplayField) return "";

  const uniqueValues = [];
  const seenValues = new Set();

  messages.forEach((message) => {
    extractGroupValues(message, trimmedDisplayField, cache).forEach((value) => {
      if (!value || seenValues.has(value)) return;
      seenValues.add(value);
      uniqueValues.push(value);
    });
  });

  if (uniqueValues.length === 0) return "";

  const visibleValues = uniqueValues.slice(0, 2).join(", ");
  return uniqueValues.length > 2
    ? `${trimmedDisplayField}: ${visibleValues} +${uniqueValues.length - 2}`
    : `${trimmedDisplayField}: ${visibleValues}`;
};

const getFirstOutgoingTimestamp = (messages) => {
  const outgoingTimestamps = messages
    .filter((message) => message.direction === "outgoing")
    .map((message) => message.timestamp);

  if (outgoingTimestamps.length > 0) {
    return Math.min(...outgoingTimestamps);
  }

  const messageTimestamps = messages.map((message) => message.timestamp);
  return messageTimestamps.length > 0
    ? Math.min(...messageTimestamps)
    : Number.MAX_SAFE_INTEGER;
};

const getFirstMessageTimestamp = (messages) => {
  const messageTimestamps = messages.map((message) => message.timestamp);
  return messageTimestamps.length > 0
    ? Math.min(...messageTimestamps)
    : Number.MAX_SAFE_INTEGER;
};

const getLatestMessageTimestamp = (messages) => {
  const messageTimestamps = messages.map((message) => message.timestamp);
  return messageTimestamps.length > 0
    ? Math.max(...messageTimestamps)
    : Number.MIN_SAFE_INTEGER;
};

const sortSections = (sections, groupSortMode) => {
  return [...sections].sort((a, b) => {
    let diff = 0;

    switch (groupSortMode) {
      case "firstMessage":
        diff =
          getFirstMessageTimestamp(a.messages) -
          getFirstMessageTimestamp(b.messages);
        break;
      case "latestMessage":
        diff =
          getLatestMessageTimestamp(b.messages) -
          getLatestMessageTimestamp(a.messages);
        break;
      case "groupValue":
        diff = a.title.localeCompare(b.title);
        break;
      case "messageCount":
        diff = b.messages.length - a.messages.length;
        break;
      case "firstOutgoing":
      default:
        diff =
          getFirstOutgoingTimestamp(a.messages) -
          getFirstOutgoingTimestamp(b.messages);
        break;
    }

    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });
};

export const buildMessageSections = ({
  sortedMessages,
  groupEnabled,
  groupField,
  groupValue,
  groupDisplayField,
  groupSortMode,
  otherTitle,
  missingFieldTitle,
  cache,
}) => {
  const trimmedField = groupField.trim();
  const trimmedValue = groupValue.trim();

  if (!groupEnabled || !trimmedField) {
    return [{ id: "all", title: "", messages: sortedMessages, isGrouped: false }];
  }

  if (trimmedValue) {
    const groupedMessages = [];
    const ungroupedMessages = [];

    sortedMessages.forEach((message) => {
      const values = extractGroupValues(message, trimmedField, cache);
      if (values.some((currentValue) => currentValue === trimmedValue)) {
        groupedMessages.push(message);
      } else {
        ungroupedMessages.push(message);
      }
    });

    return sortSections(
      [
        {
          id: `match:${trimmedField}:${trimmedValue}`,
          title: `${trimmedField} = ${trimmedValue}`,
          messages: groupedMessages,
          displayValue: getGroupDisplayValue(
            groupedMessages,
            groupDisplayField,
            cache
          ),
          isGrouped: true,
        },
        {
          id: `other:${trimmedField}:${trimmedValue}`,
          title: otherTitle,
          messages: ungroupedMessages,
          displayValue: getGroupDisplayValue(
            ungroupedMessages,
            groupDisplayField,
            cache
          ),
          isGrouped: true,
        },
      ].filter((section) => section.messages.length > 0),
      groupSortMode
    );
  }

  const sectionsByValue = new Map();
  const noValueMessages = [];

  sortedMessages.forEach((message) => {
    const values = extractGroupValues(message, trimmedField, cache);
    if (values.length === 0) {
      noValueMessages.push(message);
      return;
    }

    const firstValue = values[0];
    if (!sectionsByValue.has(firstValue)) {
      sectionsByValue.set(firstValue, []);
    }
    sectionsByValue.get(firstValue).push(message);
  });

  const groupedSections = Array.from(sectionsByValue.entries()).map(
    ([value, messages]) => ({
      id: `value:${trimmedField}:${value}`,
      title: `${trimmedField} = ${value}`,
      messages,
      displayValue: getGroupDisplayValue(messages, groupDisplayField, cache),
      isGrouped: true,
    })
  );

  if (noValueMessages.length > 0) {
    groupedSections.push({
      id: `missing:${trimmedField}`,
      title: missingFieldTitle,
      messages: noValueMessages,
      displayValue: getGroupDisplayValue(
        noValueMessages,
        groupDisplayField,
        cache
      ),
      isGrouped: true,
    });
  }

  return sortSections(groupedSections, groupSortMode);
};
