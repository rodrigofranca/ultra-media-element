// @ts-nocheck
import { defineConfig, transformWithEsbuild } from 'vite';
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
      // Vite's lib mode deliberately leaves the `es` format un-minified
      // (whitespace and every source comment ship verbatim) - only `umd` is
      // minified. Anyone loading the ESM straight from a CDN with
      // <script type="module"> would download ~30% more than needed, and
      // size-limit was budgeting documentation instead of code. Minify the
      // es chunk ourselves, keeping the per-entry syntax target.
      {
        name: 'minify-es-lib-output',
        apply: 'build',
        renderChunk: {
          order: 'post',
          async handler(code, chunk, outputOptions) {
            if (outputOptions.format !== 'es') return null;
            const result = await transformWithEsbuild(code, chunk.fileName, {
              minify: true,
              target: isCore ? 'es2017' : 'esnext',
              sourcemap: true,
              legalComments: 'none',
            });
            return { code: result.code, map: result.map };
          },
        },
      },
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
      // `.cjs` for the umd build, not `.js` - package.json sets
      // "type": "module", so a plain `.js` file is always ESM to Node
      // regardless of its actual (CJS/UMD) content, and require() of it
      // either throws ERR_REQUIRE_ESM or (newer Node, require(esm) support)
      // silently loads it as ESM, in both cases never reaching the UMD
      // wrapper's own `typeof module !== 'undefined'` CJS branch - `.cjs`
      // is unconditionally CommonJS to Node, so that branch actually runs
      // (see result-cycle2.md, defect 5).
      fileName: (format) => `${target.fileBase}.${format}.${format === 'umd' ? 'cjs' : 'js'}`,
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
