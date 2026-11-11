// Bundles the local MCP server into one self-contained file: local/helmsman-mcp.mjs.
// Also packs it as worker/public/helmsman-mcp.tgz so clients can run it without npm:
//   npx -y --package=<gateway>/helmsman-mcp.tgz helmsman-mcp
// Usage: node scripts/build-local.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'local', 'helmsman-mcp.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'local/src/main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  // Optional native speedups of `ws`; it falls back to plain JS without them.
  external: ['bufferutil', 'utf-8-validate'],
  // Bundled CommonJS dependencies (ws) call require() on Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
fs.chmodSync(outfile, 0o755);
console.log(`Built ${path.relative(root, outfile)} (${Math.round(fs.statSync(outfile).size / 1024)} KB)`);

// Tarball served by the gateway as a static asset (see worker/wrangler.jsonc "assets").
const assets = path.join(root, 'worker', 'public');
fs.mkdirSync(assets, { recursive: true });
const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', assets], { cwd: path.join(root, 'local'), encoding: 'utf8' }).trim().split('\n').pop();
fs.renameSync(path.join(assets, packed), path.join(assets, 'helmsman-mcp.tgz'));
console.log('Packed worker/public/helmsman-mcp.tgz');
