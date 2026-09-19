// The UMD bundles are emitted as `*.umd.cjs` so that Node's `require()` treats
// them as CommonJS inside this `"type": "module"` package. Browsers need a
// second copy named `*.umd.js`: public CDNs serve `.cjs` as `application/node`
// with `X-Content-Type-Options: nosniff` (jsDelivr does), and a
// `<script src="….umd.cjs">` is then refused. Same bytes, two names.
import { copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
for (const file of readdirSync(dist)) {
  if (!file.endsWith('.umd.cjs')) continue;
  copyFileSync(join(dist, file), join(dist, file.replace(/\.cjs$/, '.js')));
}
