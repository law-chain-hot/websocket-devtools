import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, dueAt: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  runUntil(targetTime) {
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= targetTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;

      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.dueAt;
      task.callback();
    }
    this.now = targetTime;
  }
}

class NonResponsiveWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = NonResponsiveWebSocket.CONNECTING;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  send() {}

  close() {
    this.readyState = NonResponsiveWebSocket.CLOSING;
  }

  emit(type, event = {}) {
    if (type === "open") this.readyState = NonResponsiveWebSocket.OPEN;
    if (type === "close") this.readyState = NonResponsiveWebSocket.CLOSED;
    for (const listener of this.listeners.get(type) ?? []) listener.call(this, event);
  }
}

async function createHarness() {
  const injectedSource = await readFile(
    new URL("../src/content/injected.js", import.meta.url),
    "utf8",
  );
  const clock = new FakeClock();
  const postedMessages = [];
  const windowListeners = new Map();
  const fakeWindow = {
    WebSocket: NonResponsiveWebSocket,
    location: { href: "https://example.com/app" },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    postMessage(message) {
      postedMessages.push(message);
    },
  };
  fakeWindow.top = fakeWindow;

  vm.runInContext(
    injectedSource,
    vm.createContext({
      ArrayBuffer,
      Blob,
      CloseEvent: class CloseEvent {},
      Date,
      JSON,
      Map,
      Math,
      MessageEvent: class MessageEvent {},
      TextDecoder,
      URL,
      Uint8Array,
      atob,
      btoa,
      clearInterval() {},
      clearTimeout: clock.clearTimeout.bind(clock),
      console,
      history: { pushState() {}, replaceState() {} },
      queueMicrotask,
      setInterval() {
        return 1;
      },
      setTimeout: clock.setTimeout.bind(clock),
      window: fakeWindow,
    }),
  );

  return {
    clock,
    fakeWindow,
    postedMessages,
    sendControlMessage(data) {
      for (const listener of windowListeners.get("message") ?? []) {
        listener({ data });
      }
    },
  };
}

test("finishes a client close when the peer never completes the handshake", async () => {
  const harness = await createHarness();
  const socket = new harness.fakeWindow.WebSocket("wss://example.com/socket");
  socket.emit("open");
  harness.clock.runUntil(100);
  harness.postedMessages.length = 0;

  harness.sendControlMessage({
    source: "websocket-proxy-content",
    type: "simulate-system-event",
    connectionId: socket._connectionId,
    eventType: "client-close",
    code: 1000,
    reason: "Closed by user",
  });
  harness.clock.runUntil(10_000);

  const closeEvents = harness.postedMessages
    .filter((message) => message.type === "websocket-event-batch")
    .flatMap((message) => message.payload)
    .filter((event) => event.id === socket._connectionId && event.type === "close");

  assert.equal(socket.readyState, NonResponsiveWebSocket.CLOSING);
  assert.equal(closeEvents.length, 1);
  assert.equal(closeEvents[0].status, "closed");
  assert.equal(closeEvents[0].simulated, true);
  assert.equal(closeEvents[0].systemEventType, "client-close");

  socket.emit("close", { code: 1000, reason: "Closed by user" });
  harness.clock.runUntil(10_100);
  const closeEventsAfterNativeClose = harness.postedMessages
    .filter((message) => message.type === "websocket-event-batch")
    .flatMap((message) => message.payload)
    .filter((event) => event.id === socket._connectionId && event.type === "close");
  assert.equal(closeEventsAfterNativeClose.length, 1);
});

test("reports a requested client close while monitoring is stopped", async () => {
  const harness = await createHarness();
  const socket = new harness.fakeWindow.WebSocket("wss://example.com/socket");
  socket.emit("open");
  harness.clock.runUntil(100);
  harness.postedMessages.length = 0;

  harness.sendControlMessage({
    source: "websocket-proxy-content",
    type: "stop-monitoring",
  });
  harness.sendControlMessage({
    source: "websocket-proxy-content",
    type: "simulate-system-event",
    connectionId: socket._connectionId,
    eventType: "client-close",
    code: 1000,
    reason: "Closed by user",
  });
  socket.emit("close", { code: 1000, reason: "Closed by user" });
  harness.clock.runUntil(1_000);

  const closeEvents = harness.postedMessages
    .filter((message) => message.type === "websocket-event-batch")
    .flatMap((message) => message.payload)
    .filter((event) => event.id === socket._connectionId && event.type === "close");
  assert.equal(closeEvents.length, 1);
  assert.equal(closeEvents[0].status, "closed");
});
