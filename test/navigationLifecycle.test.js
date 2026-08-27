import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const sourceRoot = process.env.WSDT_SOURCE_ROOT
  ? pathToFileURL(`${path.resolve(process.env.WSDT_SOURCE_ROOT)}${path.sep}`)
  : new URL("../src/", import.meta.url);

async function readSource(relativePath) {
  return readFile(new URL(relativePath, sourceRoot), "utf8");
}

function createEvent() {
  let listener;
  return {
    addListener(candidate) {
      listener = candidate;
    },
    emit(...args) {
      return listener?.(...args);
    },
  };
}

async function createBackgroundHarness() {
  const runtimeMessage = createEvent();
  const tabUpdated = createEvent();
  const chrome = {
    runtime: {
      onConnect: createEvent(),
      onInstalled: createEvent(),
      onMessage: runtimeMessage,
      onStartup: createEvent(),
      onSuspend: createEvent(),
      onUpdateAvailable: createEvent(),
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({});
        },
        set() {},
      },
    },
    tabs: {
      onRemoved: createEvent(),
      onUpdated: tabUpdated,
      query(_query, callback) {
        if (callback) callback([]);
        return Promise.resolve([]);
      },
      sendMessage() {
        return Promise.resolve({});
      },
    },
  };

  const context = vm.createContext({
    URL,
    chrome,
    clearInterval,
    console,
    Date,
    Map,
    setInterval,
  });
  vm.runInContext(await readSource("background/background.js"), context);

  function sendMessage(message, sender = {}) {
    let response;
    runtimeMessage.emit(message, sender, (value) => {
      response = value;
    });
    return response;
  }

  return {
    addConnection(tabId, id) {
      sendMessage(
        {
          type: "websocket-event",
          data: { id, type: "connection", url: "wss://example.com/socket" },
        },
        { tab: { id: tabId } },
      );
    },
    getConnections() {
      return sendMessage({ type: "get-existing-data" }).data;
    },
    pageLoaded(tabId, url = "https://example.com/reloaded") {
      sendMessage({ type: "page-loaded" }, { tab: { id: tabId, url } });
    },
    updateTab(tabId, changeInfo) {
      tabUpdated.emit(tabId, changeInfo, { id: tabId });
    },
  };
}

async function collectContentScriptMessages({ topFrame }) {
  const messages = [];
  const pageWindow = {
    addEventListener() {},
    postMessage() {},
  };
  pageWindow.top = topFrame ? pageWindow : {};

  const chrome = {
    runtime: {
      getURL(pathname) {
        return `chrome-extension://test/${pathname}`;
      },
      onMessage: createEvent(),
      sendMessage(message) {
        messages.push(message);
        return Promise.resolve({});
      },
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ "websocket-proxy-enabled": false });
        },
      },
    },
  };

  vm.runInContext(await readSource("content/content.js"), vm.createContext({ chrome, window: pageWindow }));
  await Promise.resolve();
  return messages;
}

test("preserves stored connections during an HTTP SPA URL update", async () => {
  const background = await createBackgroundHarness();
  background.addConnection(7, "connection-7");

  background.updateTab(7, {
    status: "loading",
    url: "https://example.com/route-two",
  });

  assert.equal(background.getConnections().length, 1);
});

test("clears only the reloaded tab when page-loaded arrives", async () => {
  const background = await createBackgroundHarness();
  background.addConnection(7, "connection-7");
  background.addConnection(8, "connection-8");

  background.pageLoaded(7);

  assert.deepEqual(
    Array.from(background.getConnections(), (connection) => connection.id),
    ["connection-8"],
  );
});

test("clears stale connections when navigating outside content-script URLs", async () => {
  const background = await createBackgroundHarness();
  background.addConnection(7, "connection-7");

  background.updateTab(7, { url: "edge://extensions" });

  assert.equal(background.getConnections().length, 0);
});

test("signals page-loaded only from the top frame", async () => {
  const topFrameMessages = await collectContentScriptMessages({ topFrame: true });
  const iframeMessages = await collectContentScriptMessages({ topFrame: false });

  assert.equal(topFrameMessages.length, 1);
  assert.equal(topFrameMessages[0].type, "page-loaded");
  assert.equal(iframeMessages.length, 0);
});
