import { useSyncExternalStore } from 'react';
import { getColorScheme, subscribeTheme } from '../utils/theme.js';

// All consumers share the preference, including CodeMirror and Mantine portals.
export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getColorScheme);
}
