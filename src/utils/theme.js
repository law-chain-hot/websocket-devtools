/** @typedef {'dark' | 'light'} ColorScheme */

// One extension-wide preference keeps the popup and every panel in sync.
export const THEME_STORAGE_KEY = 'websocket-devtools-theme';
/** @type {ColorScheme} */
let colorScheme = 'dark';
// Invalidates pending initialization when a newer preference arrives.
let revision = 0;
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {Promise<void> | undefined} */
let initialization;

/**
 * Apply only to extension documents; content-script hints use their own scope.
 * @param {unknown} value
 */
function applyColorScheme(value) {
  colorScheme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = colorScheme;
  listeners.forEach((listener) => listener());
}

/** Restore the preference before mounting React, without writing a default. */
export function initializeTheme() {
  if (initialization) return initialization;
  applyColorScheme(colorScheme);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, THEME_STORAGE_KEY)) {
      revision += 1;
      applyColorScheme(changes[THEME_STORAGE_KEY].newValue);
    }
  });
  const initialRevision = revision;
  initialization = new Promise((resolve) => {
    chrome.storage.local.get(THEME_STORAGE_KEY, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn('Failed to restore theme preference:', error);
        resolve();
        return;
      }
      // A newer storage event or user action wins over this initial read.
      if (revision === initialRevision) applyColorScheme(result[THEME_STORAGE_KEY]);
      resolve();
    });
  });
  return initialization;
}

export const getColorScheme = () => colorScheme;

/**
 * Subscribe without remounting editors or resetting business state.
 * @param {() => void} listener
 */
export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @param {ColorScheme} value */
export function setColorScheme(value) {
  revision += 1;
  applyColorScheme(value);
  chrome.storage.local.set({ [THEME_STORAGE_KEY]: colorScheme }, () => {
    const error = chrome.runtime.lastError;
    if (error) console.warn('Failed to save theme preference:', error);
  });
}
