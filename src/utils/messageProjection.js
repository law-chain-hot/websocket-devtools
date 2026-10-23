/**
 * @typedef {string | number} ProjectionPathToken
 * @typedef {{ ok: true, tokens: ProjectionPathToken[] } | { ok: false, error: string }} ProjectionPathParseResult
 * @typedef {{ status: "matched", value: unknown, formatted: FormattedProjectionValue } | { status: "missing" | "invalid-json" | "unsupported" | "not-applicable" }} ProjectionResult
 * @typedef {{ text: string, valueType: string, isEmptyString: boolean, isWhitespaceOnly: boolean }} FormattedProjectionValue
 * @typedef {{ path: string, preview: string }} ProjectionCandidate
 */

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const MAX_CANDIDATE_PREVIEW_LENGTH = 80;

/**
 * Parse the intentionally small, exact field-path grammar used by the list.
 * It does not accept JSONPath expressions, wildcards, or executable syntax.
 *
 * @param {string} path
 * @returns {ProjectionPathParseResult}
 */
export const parseProjectionPath = (path) => {
  const source = typeof path === "string" ? path.trim() : "";
  if (!source) return { ok: false, error: "empty" };

  /** @type {ProjectionPathToken[]} */
  const tokens = [];
  let index = 0;
  let expectsSegment = source[0] !== "[";

  const readIndex = () => {
    const start = index;
    while (/\d/.test(source[index] || "")) index += 1;
    const rawIndex = source.slice(start, index);
    if (!/^(0|[1-9]\d*)$/.test(rawIndex)) return null;
    const value = Number(rawIndex);
    return Number.isSafeInteger(value) ? value : null;
  };

  const readIdentifier = () => {
    if (!IDENTIFIER_START.test(source[index] || "")) return null;
    const start = index;
    index += 1;
    while (IDENTIFIER_PART.test(source[index] || "")) index += 1;
    return source.slice(start, index);
  };

  while (index < source.length) {
    if (expectsSegment) {
      const identifier = readIdentifier();
      if (!identifier) return { ok: false, error: "expected-property" };
      tokens.push(identifier);
      expectsSegment = false;
      continue;
    }

    const character = source[index];
    if (character === ".") {
      index += 1;
      if (/\d/.test(source[index] || "")) {
        const arrayIndex = readIndex();
        if (arrayIndex === null) return { ok: false, error: "invalid-index" };
        tokens.push(arrayIndex);
        continue;
      }
      const identifier = readIdentifier();
      if (!identifier) return { ok: false, error: "expected-property" };
      tokens.push(identifier);
      continue;
    }

    if (character !== "[") return { ok: false, error: "unexpected-token" };
    index += 1;
    if (/\d/.test(source[index] || "")) {
      const arrayIndex = readIndex();
      if (arrayIndex === null) return { ok: false, error: "invalid-index" };
      if (source[index] !== "]") return { ok: false, error: "expected-bracket" };
      tokens.push(arrayIndex);
      index += 1;
      continue;
    }

    if (source[index] !== '"') return { ok: false, error: "expected-index" };
    const quotedStart = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const current = source[index];
      if (!escaped && current === '"') break;
      escaped = !escaped && current === "\\";
      if (current !== "\\") escaped = false;
      index += 1;
    }
    if (source[index] !== '"' || source[index + 1] !== "]") {
      return { ok: false, error: "expected-bracket" };
    }
    try {
      const parsedKey = JSON.parse(source.slice(quotedStart, index + 1));
      tokens.push(parsedKey);
    } catch {
      return { ok: false, error: "invalid-quoted-key" };
    }
    index += 2;
  }

  return tokens.length > 0
    ? { ok: true, tokens }
    : { ok: false, error: "empty" };
};

const isBinaryValue = (value) =>
  value instanceof ArrayBuffer ||
  ArrayBuffer.isView(value) ||
  (typeof Blob !== "undefined" && value instanceof Blob);

const readMessagePayload = (message) => {
  if (!message || typeof message !== "object" || message.type !== "message") {
    return { status: "not-applicable" };
  }

  const value = message.data;
  if (typeof value === "string") {
    try {
      return { status: "parsed", value: JSON.parse(value) };
    } catch {
      return { status: "invalid-json" };
    }
  }
  if (value !== null && typeof value === "object" && !isBinaryValue(value)) {
    return { status: "parsed", value };
  }
  return { status: "unsupported" };
};

/**
 * Cache entries are tied to message identities and reset when their payload changes.
 * @returns {{ entries: WeakMap<object, { data: unknown, type: unknown, parsed: ReturnType<typeof readMessagePayload>, path: string | null, result: ProjectionResult }> }}
 */
export const createMessageProjectionCache = () => ({ entries: new WeakMap() });

const getCacheEntry = (message, cache) => {
  if (!cache || !message || typeof message !== "object") {
    return {
      data: message?.data,
      type: message?.type,
      parsed: readMessagePayload(message),
      path: null,
      result: { status: "missing" },
    };
  }

  const cached = cache.entries.get(message);
  if (cached && cached.data === message.data && cached.type === message.type) return cached;

  const next = {
    data: message.data,
    type: message.type,
    parsed: readMessagePayload(message),
    path: null,
    result: { status: "missing" },
  };
  cache.entries.set(message, next);
  return next;
};

/**
 * Extract one exact path without following prototype properties or parsing nested JSON strings.
 * @param {{ type?: unknown, data?: unknown }} message
 * @param {ProjectionPathToken[] | null} tokens
 * @param {ReturnType<typeof createMessageProjectionCache>} cache
 * @param {string} pathKey
 * @returns {ProjectionResult}
 */
export const extractMessageField = (message, tokens, cache, pathKey = "") => {
  const entry = getCacheEntry(message, cache);
  if (entry.path === pathKey) return entry.result;

  /** @type {ProjectionResult} */
  let result;
  if (entry.parsed.status !== "parsed") {
    result = { status: entry.parsed.status };
  } else {
    let value = entry.parsed.value;
    let found = true;
    for (const token of tokens) {
      if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, token)) {
        found = false;
        break;
      }
      value = value[token];
    }
    result = found
      ? { status: "matched", value, formatted: formatProjectedValue(value) }
      : { status: "missing" };
  }

  // Keep just the current path result for each retained message.
  entry.path = pathKey;
  entry.result = result;
  return result;
};

/**
 * Format JSON values for text-node rendering while preserving string whitespace.
 * @param {unknown} value
 * @returns {FormattedProjectionValue}
 */
export const formatProjectedValue = (value) => {
  if (typeof value === "string") {
    return {
      text: value,
      valueType: "string",
      isEmptyString: value.length === 0,
      isWhitespaceOnly: value.length > 0 && /^\s+$/u.test(value),
    };
  }
  if (value === null) {
    return { text: "null", valueType: "null", isEmptyString: false, isWhitespaceOnly: false };
  }
  if (typeof value === "object") {
    try {
      return { text: JSON.stringify(value), valueType: Array.isArray(value) ? "array" : "object", isEmptyString: false, isWhitespaceOnly: false };
    } catch {
      return { text: String(value), valueType: "object", isEmptyString: false, isWhitespaceOnly: false };
    }
  }
  return { text: String(value), valueType: typeof value, isEmptyString: false, isWhitespaceOnly: false };
};

const appendPath = (basePath, key, isIndex) => {
  if (isIndex) return `${basePath}[${key}]`;
  const property = IDENTIFIER_START.test(key[0] || "") && [...key].every((character) => IDENTIFIER_PART.test(character));
  return property
    ? (basePath ? `${basePath}.${key}` : key)
    : `${basePath}[${JSON.stringify(key)}]`;
};

/**
 * Collect scalar leaf candidates using bounded traversal. It never materializes a full key list.
 * @param {Array<{ type?: unknown, data?: unknown }>} messages
 * @param {{ maxMessages?: number, maxDepth?: number, maxNodes?: number, maxCandidates?: number }} [budget]
 * @param {ReturnType<typeof createMessageProjectionCache>} [cache]
 * @returns {ProjectionCandidate[]}
 */
export const collectFieldCandidates = (messages, budget = {}, cache) => {
  const maxMessages = budget.maxMessages ?? 50;
  const maxDepth = budget.maxDepth ?? 12;
  const maxNodes = budget.maxNodes ?? 5000;
  const maxCandidates = budget.maxCandidates ?? 200;
  const candidates = [];
  const paths = new Set();
  let visitedNodes = 0;

  for (const message of messages.slice(0, maxMessages)) {
    if (visitedNodes >= maxNodes || candidates.length >= maxCandidates) break;
    const parsed = getCacheEntry(message, cache).parsed;
    if (parsed.status !== "parsed" || parsed.value === null || typeof parsed.value !== "object") continue;
    const seen = new WeakSet();
    const stack = [{ value: parsed.value, path: "", depth: 0 }];

    while (stack.length > 0 && visitedNodes < maxNodes && candidates.length < maxCandidates) {
      const current = stack.pop();
      if (!current || current.value === null || typeof current.value !== "object") continue;
      if (seen.has(current.value)) continue;
      seen.add(current.value);
      if (current.depth >= maxDepth) continue;

      const visitChild = (key, child, isIndex) => {
        if (visitedNodes >= maxNodes || candidates.length >= maxCandidates) return;
        // Every property/element read consumes budget, including duplicate paths.
        visitedNodes += 1;
        const path = appendPath(current.path, String(key), isIndex);
        if (child !== null && typeof child === "object") {
          stack.push({ value: child, path, depth: current.depth + 1 });
          return;
        }
        if (paths.has(path)) return;
        paths.add(path);
        const formatted = formatProjectedValue(child);
        const preview = formatted.text.length > MAX_CANDIDATE_PREVIEW_LENGTH
          ? `${formatted.text.slice(0, MAX_CANDIDATE_PREVIEW_LENGTH)}…`
          : formatted.text;
        candidates.push({ path, preview: preview.replace(/\s/g, " ") });
      };

      if (Array.isArray(current.value)) {
        for (let index = 0; index < current.value.length; index += 1) {
          if (visitedNodes >= maxNodes || candidates.length >= maxCandidates) break;
          visitChild(index, current.value[index], true);
        }
      } else {
        for (const key in current.value) {
          if (visitedNodes >= maxNodes || candidates.length >= maxCandidates) break;
          if (!Object.prototype.hasOwnProperty.call(current.value, key)) continue;
          visitChild(key, current.value[key], false);
        }
      }
    }
  }
  return candidates;
};

/**
 * Apply projection visibility after the existing filter, sort, and grouping pipeline.
 * @param {{ id: string, isGrouped: boolean, messages: Array<object> }[]} messageSections
 * @param {{ mode: "raw" | "field", path: string, hideMissing: boolean, hideEmpty: boolean }} config
 * @param {ProjectionPathToken[]} tokens
 * @param {ReturnType<typeof createMessageProjectionCache>} cache
 */
export const buildProjectedSections = (messageSections, config, tokens, cache) => (
  messageSections
    .map((section) => {
      const projectedMessages = section.messages
        .map((message) => ({
          message,
          result: config.mode === "field" && tokens
            ? extractMessageField(message, tokens, cache, config.path)
            : config.mode === "field" ? { status: "missing" } : null,
        }))
        .filter(({ result }) => {
          if (config.mode !== "field") return true;
          if (result.status !== "matched") return !config.hideMissing;
          return !(config.hideEmpty && result.formatted.isEmptyString);
        });
      return { ...section, projectedMessages };
    })
    .filter((section) => section.projectedMessages.length > 0)
);

/** @param {Array<{ projectedMessages: Array<{ message: object }> }>} projectedSections */
export const getProjectedMessages = (projectedSections) => (
  projectedSections.flatMap((section) => section.projectedMessages.map(({ message }) => message))
);

/**
 * Keep keyboard selection aligned with rows actually rendered after group collapse.
 * @param {Array<{ id: string, isGrouped: boolean, projectedMessages: Array<{ message: object }> }>} projectedSections
 * @param {Record<string, boolean>} collapsedGroups
 */
export const getVisibleProjectedMessages = (projectedSections, collapsedGroups) => (
  projectedSections.flatMap((section) => (
    section.isGrouped && collapsedGroups[section.id]
      ? []
      : section.projectedMessages.map(({ message }) => message)
  ))
);
