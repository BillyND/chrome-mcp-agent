// Builds the extension into extension/unpacked and packs extension/chrome-mcp-agent.zip.
// Usage: [HELMSMAN_PORT=47821] node scripts/pack-extension.mjs [--dev] [--gateway https://...]
//   HELMSMAN_PORT  port of the local MCP server the extension's "Local mode" connects to
//   --dev      points at http://localhost:$E2E_PORT (default 8787; used by the e2e tests)
//   --gateway  overrides the gateway origin; defaults to PUBLIC_URL in worker/wrangler.jsonc

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { writeIcons } from './icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const out = path.join(ext, 'unpacked');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function gatewayFromWrangler() {
  const raw = fs.readFileSync(path.join(root, 'worker', 'wrangler.jsonc'), 'utf8');
  const m = /"PUBLIC_URL"\s*:\s*"([^"]+)"/.exec(raw);
  return m?.[1];
}

const localPort = Number(process.env.HELMSMAN_PORT ?? 47821);
const gateway = (argv.includes('--dev') ? `http://localhost:${process.env.E2E_PORT ?? 8787}` : flag('--gateway') ?? gatewayFromWrangler() ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(gateway) || gateway.includes('REPLACE')) {
  console.error(`Gateway URL is not set (got "${gateway}"). Deploy the worker first or pass --gateway https://...`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const common = {
  bundle: true,
  target: 'chrome125',
  minify: !argv.includes('--dev'),
  sourcemap: argv.includes('--dev') ? 'inline' : false,
  define: { __GATEWAY_URL__: JSON.stringify(gateway), __LOCAL_PORT__: String(localPort) },
  logLevel: 'warning',
};
await esbuild.build({ ...common, entryPoints: [path.join(ext, 'src/background/index.ts')], outfile: path.join(out, 'background.js'), format: 'esm' });
await esbuild.build({ ...common, entryPoints: [path.join(ext, 'src/content/index.ts')], outfile: path.join(out, 'content.js'), format: 'iife' });
// The popup and the audit page are React apps sharing one stylesheet.
for (const [entry, file] of [['popup/app.tsx', 'popup.js'], ['audit/app.tsx', 'audit.js']]) {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(ext, 'src', entry)],
    outfile: path.join(out, file),
    format: 'iife',
    jsx: 'automatic',
    define: { ...common.define, 'process.env.NODE_ENV': JSON.stringify(argv.includes('--dev') ? 'development' : 'production') },
  });
}
// Tailwind v4 compiles the shadcn theme and the classes used by the popup.
execFileSync(process.execPath, [path.join(root, 'node_' + 'modules', '@tailwindcss', 'cli', 'dist', 'index.mjs'), '-i', path.join(ext, 'src/popup/styles.css'), '-o', path.join(out, 'popup.css'), '--minify'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
manifest.version = pkg.version;
if (manifest.background) manifest.background.type = 'module';
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const f of fs.readdirSync(path.join(ext, 'public'))) fs.copyFileSync(path.join(ext, 'public', f), path.join(out, f));
writeIcons(path.join(out, 'icons'));

const zip = path.join(ext, 'chrome-mcp-agent.zip');
fs.rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
} catch {
  console.warn('zip not available; skipped packing');
}
// The gateway serves the zip from its landing page (Workers static assets).
if (fs.existsSync(zip)) {
  const assets = path.join(root, 'worker', 'public');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(zip, path.join(assets, 'chrome-mcp-agent.zip'));
}
console.log(`Built extension for ${gateway} -> ${path.relative(root, out)} (+ ${path.relative(root, zip)})`);
