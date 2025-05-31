// @ts-nocheck
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import replace from '@rollup/plugin-replace';
import path from 'path';
import fs from 'fs';
import pkg from './package.json';
import dts from 'vite-plugin-dts';

const packageName = 'ultra-media-element';

export default defineConfig(({ command, mode }) => {
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
        entryRoot: 'src',               // foca no src/index.ts
        include: ['src'],      // 👈 restringe o que será gerado
        exclude: ['src/**/internal/**', 'src/utils/**', 'src/players/**'],
        // rollupTypes: true,
        insertTypesEntry: true,
        copyDtsFiles: true
      }),
    ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: packageName,
      fileName: (format) => `${packageName}.${format}.js`,
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
  server: mode === 'development' && {
    host: 'dev.ultramedia',
    port: 443,
    https: true,
    hmr: {
      overlay: false
    }
  }
}
});
