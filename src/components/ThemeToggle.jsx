import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import { setColorScheme } from '../utils/theme.js';
import { t } from '../utils/i18n.js';

const ThemeToggle = () => {
  const colorScheme = useTheme();
  const label = t(colorScheme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark');
  const Icon = colorScheme === 'dark' ? Sun : Moon;

  return (
    <button
      type="button"
      className="theme-toggle"
      title={label}
      aria-label={label}
      onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
};

export default ThemeToggle;
