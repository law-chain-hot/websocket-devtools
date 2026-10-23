import assert from 'node:assert/strict';
import test from 'node:test';

function createThemeStorage(saved) {
  const storageListeners = new Set();
  const writes = [];

  const emit = (value, area = 'local', sourceDocument) => {
    const changes = { 'websocket-devtools-theme': { newValue: value } };
    if (area === 'local') saved = value;
    storageListeners.forEach(({ listener, document }) => {
      if (document === sourceDocument) return;
      listener(changes, area);
    });
  };

  return {
    createChrome(document) {
      const chrome = {
        runtime: { lastError: undefined },
        storage: {
          local: {
            get: (_key, callback) => callback({ 'websocket-devtools-theme': saved }),
            set: (value, callback) => {
              writes.push(value);
              emit(value['websocket-devtools-theme'], 'local', document);
              callback();
            },
          },
          onChanged: {
            addListener(listener) {
              storageListeners.add({
                document,
                listener: (changes, area) => {
                  const previousDocument = globalThis.document;
                  const previousChrome = globalThis.chrome;
                  globalThis.document = document;
                  globalThis.chrome = chrome;
                  try {
                    listener(changes, area);
                  } finally {
                    globalThis.document = previousDocument;
                    globalThis.chrome = previousChrome;
                  }
                },
              });
            },
          },
        },
      };
      return chrome;
    },
    emit,
    storageListeners,
    writes,
  };
}

// Each isolated module represents an extension document sharing a storage backend.
async function createThemeDocument({ saved, pendingRead = false, storage = createThemeStorage(saved) } = {}) {
  const document = { documentElement: { dataset: {} } };
  let completeRead;
  const chrome = storage.createChrome(document);
  if (pendingRead) {
    chrome.storage.local.get = (_key, callback) => {
      completeRead = (result) => callback(result);
    };
  }
  globalThis.document = document;
  globalThis.chrome = chrome;
  const theme = await import(`../src/utils/theme.js?document=${crypto.randomUUID()}`);
  return {
    theme,
    document,
    storageListeners: storage.storageListeners,
    writes: storage.writes,
    completeRead: (result) => completeRead(result),
    emit: storage.emit,
    activate: () => {
      globalThis.document = document;
      globalThis.chrome = chrome;
    },
  };
}

test('theme defaults to the existing dark palette without changing saved settings', async () => {
  const { theme, document, writes, storageListeners } = await createThemeDocument();
  await theme.initializeTheme();
  await theme.initializeTheme();
  assert.equal(theme.getColorScheme(), 'dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(storageListeners.size, 1);
  assert.deepEqual(writes, []);
});

test('saved light theme restores and user changes persist without remounting consumers', async () => {
  const { theme, document, writes } = await createThemeDocument({ saved: 'light' });
  await theme.initializeTheme();
  assert.equal(theme.getColorScheme(), 'light');
  let notifications = 0;
  const unsubscribe = theme.subscribeTheme(() => { notifications += 1; });
  theme.setColorScheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.deepEqual(writes, [{ [theme.THEME_STORAGE_KEY]: 'dark' }]);
  assert.equal(notifications, 1);
  unsubscribe();
  theme.setColorScheme('light');
  assert.equal(notifications, 1);
});

test('external changes synchronize, ignore other storage areas, and reset on removal', async () => {
  const { theme, emit } = await createThemeDocument();
  await theme.initializeTheme();
  emit('light', 'sync');
  assert.equal(theme.getColorScheme(), 'dark');
  emit('light');
  assert.equal(theme.getColorScheme(), 'light');
  emit(undefined);
  assert.equal(theme.getColorScheme(), 'dark');
  emit('invalid');
  assert.equal(theme.getColorScheme(), 'dark');
});

test('a preference change in one extension document synchronizes to another', async () => {
  const storage = createThemeStorage();
  const first = await createThemeDocument({ storage });
  await first.theme.initializeTheme();
  const second = await createThemeDocument({ storage });
  await second.theme.initializeTheme();

  first.activate();
  first.theme.setColorScheme('light');

  assert.equal(first.document.documentElement.dataset.theme, 'light');
  assert.equal(second.theme.getColorScheme(), 'light');
  assert.equal(second.document.documentElement.dataset.theme, 'light');
});

test('a stale initial read cannot overwrite a newer external preference or user action', async () => {
  for (const change of ['external', 'user']) {
    const { theme, completeRead, emit } = await createThemeDocument({ pendingRead: true });
    const ready = theme.initializeTheme();
    if (change === 'external') emit('light');
    else theme.setColorScheme('light');
    completeRead({ [theme.THEME_STORAGE_KEY]: 'dark' });
    await ready;
    assert.equal(theme.getColorScheme(), 'light');
  }
});

test.after(() => {
  delete globalThis.document;
  delete globalThis.chrome;
});
