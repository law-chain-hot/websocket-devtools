import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  send() {}

  close() {}

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener.call(this, event);
    }
  }
}

async function loadInjectedScript({ supportReportError = true } = {}) {
  const injectedSource = await readFile(
    new URL("../src/content/injected.js", import.meta.url),
    "utf8",
  );
  const reportedErrors = [];
  const queuedMicrotasks = [];
  const windowListeners = new Map();
  const fakeWindow = {
    WebSocket: FakeWebSocket,
    location: {
      href: "https://example.com/app",
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    postMessage() {},
  };
  if (supportReportError) {
    fakeWindow.reportError = (error) => {
      reportedErrors.push(error);
    };
  }
  fakeWindow.top = fakeWindow;

  const context = vm.createContext({
    ArrayBuffer,
    Blob,
    Date,
    JSON,
    Map,
    Math,
    TextDecoder,
    URL,
    Uint8Array,
    atob,
    btoa,
    clearInterval() {},
    clearTimeout() {},
    console,
    history: {
      pushState() {},
      replaceState() {},
    },
    queueMicrotask(callback) {
      queuedMicrotasks.push(callback);
    },
    setInterval() {
      return 1;
    },
    setTimeout() {
      return 1;
    },
    window: fakeWindow,
  });

  vm.runInContext(injectedSource, context);

  return { fakeWindow, queuedMicrotasks, reportedErrors };
}

function registerThrowingCallbacks(fakeWindow) {
  const socket = new fakeWindow.WebSocket("wss://example.com/socket");
  const callbackError = new Error("subscription callback failed");
  let laterListenerRan = false;

  socket.onmessage = () => {
    throw callbackError;
  };
  socket.addEventListener("message", () => {
    laterListenerRan = true;
  });

  socket.emit("message", { data: "payload" });

  return { callbackError, laterListenerRan };
}

test("reports page callback errors without interrupting later message listeners", async () => {
  const { fakeWindow, reportedErrors } = await loadInjectedScript();
  const { callbackError, laterListenerRan } = registerThrowingCallbacks(fakeWindow);

  assert.deepEqual(reportedErrors, [callbackError]);
  assert.equal(laterListenerRan, true);
});

test("falls back to an asynchronous uncaught error when reportError is unavailable", async () => {
  const { fakeWindow, queuedMicrotasks } = await loadInjectedScript({
    supportReportError: false,
  });
  const { callbackError, laterListenerRan } = registerThrowingCallbacks(fakeWindow);

  assert.equal(queuedMicrotasks.length, 1);
  assert.throws(queuedMicrotasks[0], (error) => error === callbackError);
  assert.equal(laterListenerRan, true);
});
