import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const chromeLocaleMapping = {
  'en-us': 'en',
  'zh-cn': 'zh_CN',
  'zh-tw': 'zh_TW',
  ja: 'ja',
  de: 'de',
  fr: 'fr',
  ko: 'ko',
};
const themeKeys = ['theme.switchToLight', 'theme.switchToDark'];

test('Chrome locale catalogs include every theme toggle label', () => {
  for (const [flatLocale, chromeLocale] of Object.entries(chromeLocaleMapping)) {
    const translations = JSON.parse(fs.readFileSync(
      path.join(projectRoot, 'src/assets/locales', `${flatLocale}.json`),
      'utf8'
    ));
    const catalog = JSON.parse(fs.readFileSync(
      path.join(projectRoot, 'src/_locales', chromeLocale, 'messages.json'),
      'utf8'
    ));

    for (const key of themeKeys) {
      const chromeKey = key.replace(/\./g, '_');
      assert.equal(catalog[chromeKey]?.message, translations[key], `${chromeLocale} must include ${chromeKey}`);
    }
  }
});
