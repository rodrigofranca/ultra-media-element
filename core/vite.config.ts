// @ts-nocheck
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import replace from '@rollup/plugin-replace';
import path from 'path';
import fs from 'fs';
import pkg from './package.json';
import dts from 'vite-plugin-dts';

// Three independent entry points share this config so ads never end up in
// the core bundle, and the headless core (ADR-0001) never ends up depending
// on Custom Elements/Shadow DOM/Mux packages: `pnpm build` runs Vite three
// times (see package.json), once per entry below, selected via BUILD_ENTRY.
// The `<ultra-media>` build always runs first with emptyOutDir so it starts
// from a clean dist/; the ad and headless-core builds then add their own
// files without wiping the earlier ones.
const ENTRIES = {
  main: { entry: 'src/index.ts', name: 'ultra-media', fileBase: 'ultra-media' },
  ad: { entry: 'src/ad.ts', name: 'ultra-media-ad', fileBase: 'ultra-media-ad' },
  core: { entry: 'src/core-entry.ts', name: 'ultra-media-core', fileBase: 'ultra-media-core' },
};

export default defineConfig(({ command, mode }) => {
  const isAd = process.env.BUILD_ENTRY === 'ad';
  const isCore = process.env.BUILD_ENTRY === 'core';
  const target = isAd ? ENTRIES.ad : isCore ? ENTRIES.core : ENTRIES.main;

  return  {
    plugins: [
      replace({
        values: {
          __APP_NAME__: () => JSON.stringify(pkg.name),
          __APP_VERSION__: () => JSON.stringify(pkg.version)
        },
        preventAssignment: true
      }),
      mode === 'development' && mkcert(),
      dts({
        outputDir: 'dist',
        entryRoot: 'src',               // foca no src/index.ts e src/ad.ts
        include: ['src'],      // 👈 restringe o que será gerado
        exclude: ['src/**/internal/**', 'src/utils/**', 'src/players/**'],
        // rollupTypes: true,
        insertTypesEntry: true,
        copyDtsFiles: true
      }),
    ],
  build: {
    emptyOutDir: !isAd && !isCore,
    lib: {
      entry: path.resolve(__dirname, target.entry),
      name: target.name,
      fileName: (format) => `${target.fileBase}.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
      },
    },
    // ADR-0001 open question 1: the headless core targets the oldest Smart
    // TV runtimes it's meant to run on, so it ships ES2017 instead of the
    // shell/ad bundles' esnext - keeping native async/await and classes
    // (needed anyway - see UltraMediaCore) but nothing newer.
    target: isCore ? 'es2017' : 'esnext',
    sourcemap: true,
    minify: true,
  },
  resolve: {
    alias: {
      $: path.resolve('./src')
    }
  },
  // server: mode === 'development' && {
  //   // host: 'dev.ultramedia',
  //   port: 443,
  //   https: true,
  //   hmr: {
  //     overlay: false
  //   }
  // }
}
});
