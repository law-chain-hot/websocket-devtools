import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    webExtension({
      manifest: "./src/manifest.json",
      watchFilePaths: ["src/**/*"],
      additionalInputs: [
        "src/content/injected.js",
        "src/devtools/panel.html",
        "src/popup/popup.html",
      ],
    }),
    viteStaticCopy({
      targets: [
        // Copy icons directory
        {
          src: 'icons/*',
          dest: 'icons'
        },
        // Copy _locales directory for Chrome i18n support (preserve structure)
        {
          src: 'src/_locales',
          dest: '',
          structured: true
        },
        // Copy utils directory for i18n mapping and other utilities
        {
          src: 'src/utils',
          dest: '',
          structured: true
        }
      ]
    })
  ],
  build: {
    minify: mode === "development" ? false : true,
    sourcemap: mode === "development",
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
      },
    },
    watch:
      mode === "development"
        ? {
            include: ["src/**/*"],
            exclude: ["node_modules/**", "dist/**"],
            buildDelay: 300,
          }
        : null,
  },
}));
