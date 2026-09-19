// @ts-nocheck
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import replace from '@rollup/plugin-replace';
import path from 'path';
import fs from 'fs';
import pkg from './package.json';
import dts from 'vite-plugin-dts';

// Two independent entry points share this config so ads never end up in the
// core bundle: `pnpm build` runs Vite twice (see package.json), once per
// entry below, selected via BUILD_ENTRY. The core build always runs first
// with emptyOutDir so it starts from a clean dist/; the ad build then adds
// its own files without wiping the core ones.
const ENTRIES = {
  main: { entry: 'src/index.ts', name: 'ultra-media', fileBase: 'ultra-media' },
  ad: { entry: 'src/ad.ts', name: 'ultra-media-ad', fileBase: 'ultra-media-ad' },
};

export default defineConfig(({ command, mode }) => {
  const isAd = process.env.BUILD_ENTRY === 'ad';
  const target = isAd ? ENTRIES.ad : ENTRIES.main;

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
    emptyOutDir: !isAd,
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
    target: 'esnext',
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
