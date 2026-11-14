// Validates that extension/browser-use-bridge.zip is ready for the Chrome Web Store.
// Usage: node scripts/pack-extension.mjs && node scripts/check-store.mjs   (or: npm run check:store)
//
// Checks the manifest, the icons inside the zip, that the zip is a production build (no source maps,
// no dev gateway URL, no remote code) and that every manifest permission is justified in docs/store/listing.md.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.join(root, 'extension', 'browser-use-bridge.zip');
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

if (!fs.existsSync(zipPath)) {
  console.error(`Missing ${path.relative(root, zipPath)}. Run: node scripts/pack-extension.mjs`);
  process.exit(1);
}

const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
const read = (name) => execFileSync('unzip', ['-p', zipPath, name], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const has = (name) => entries.includes(name);

// ---- manifest -----------------------------------------------------------------------------------
check(has('manifest.json'), 'manifest.json is at the root of the zip');
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(manifest.manifest_version === 3, 'manifest_version is 3');
check(typeof manifest.name === 'string' && manifest.name.length > 0 && manifest.name.length <= 75, `name is set and at most 75 chars ("${manifest.name}")`);
check(manifest.name === 'Helmsman – AI browser agent', 'name is "Helmsman – AI browser agent"');
check(typeof manifest.description === 'string' && manifest.description.length > 0 && manifest.description.length <= 132, `description is 1-132 chars (${manifest.description?.length})`);
check(/^\d+(\.\d+){0,3}$/.test(manifest.version ?? ''), `version is a valid Chrome version (${manifest.version})`);
check(manifest.version === pkg.version, `manifest version matches package.json (${pkg.version})`);

// ---- icons: 16/32/48/128 PNGs of exactly that size ---------------------------------------------
for (const size of ['16', '32', '48', '128']) {
  const file = manifest.icons?.[size];
  if (!file || !has(file)) {
    check(false, `icons.${size} is declared and present in the zip (${file ?? 'missing'})`);
    continue;
  }
  const png = read(file);
  const isPng = png.length > 24 && png.subarray(1, 4).toString() === 'PNG';
  const dims = isPng ? [png.readUInt32BE(16), png.readUInt32BE(20)] : [0, 0];
  check(isPng && dims[0] === Number(size) && dims[1] === Number(size), `icons/${size}: PNG ${dims.join('x')}`);
}
for (const file of [manifest.action?.default_icon?.['16'], manifest.action?.default_icon?.['32']]) {
  check(!file || has(file), `action icon ${file} is in the zip`);
}

// ---- every file the manifest points at is in the zip --------------------------------------------
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);
for (const file of referenced) check(has(file), `${file} referenced by the manifest is in the zip`);

// ---- production build: no source maps, no dev gateway, no remote code ---------------------------
const maps = entries.filter((e) => /\.map$/.test(e));
check(maps.length === 0, `no .map files in the zip${maps.length ? ` (${maps.join(', ')})` : ''}`);
const code = entries.filter((e) => /\.(js|mjs|html|css)$/.test(e));
const sources = Object.fromEntries(code.map((e) => [e, read(e).toString('utf8')]));
const withMapRef = code.filter((e) => /sourceMappingURL=/.test(sources[e]));
check(withMapRef.length === 0, `no sourceMappingURL comments${withMapRef.length ? ` (${withMapRef.join(', ')})` : ''}`);

const wranglerUrl = /"PUBLIC_URL"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root, 'worker', 'wrangler.jsonc'), 'utf8'))?.[1]?.replace(/\/$/, '');
const bundle = sources['background.js'] ?? '';
check(Boolean(wranglerUrl) && !wranglerUrl.includes('REPLACE'), `worker PUBLIC_URL is set (${wranglerUrl})`);
check(Boolean(wranglerUrl) && bundle.includes(wranglerUrl), 'background.js points at the production gateway');
const devHits = code.filter((e) => /https?:\/\/localhost[:/]/.test(sources[e]) || /["'`]localhost["'`]/.test(sources[e]));
check(devHits.length === 0, `no localhost gateway URL in the zip${devHits.length ? ` (${devHits.join(', ')})` : ''}`);
check(!/eval\(\s*["'`(]?\s*await fetch|importScripts\(\s*["'`]https?:/.test(bundle), 'background.js loads no remote scripts');
const remoteScripts = code.filter((e) => e.endsWith('.html') && /<script[^>]+src=["']https?:/i.test(sources[e]));
check(remoteScripts.length === 0, `no remote <script src> in HTML pages${remoteScripts.length ? ` (${remoteScripts.join(', ')})` : ''}`);
check(!manifest.content_security_policy || !/unsafe-eval|https?:/.test(JSON.stringify(manifest.content_security_policy)), 'content_security_policy allows no remote code');
check(!has('manifest.json.bak') && !entries.some((e) => /(^|\/)\.|\.(ts|tsx)$/.test(e)), 'no dotfiles or TypeScript sources in the zip');

// ---- every permission has a justification in docs/store/listing.md --------------------------------
const listing = fs.readFileSync(path.join(root, 'docs', 'store', 'listing.md'), 'utf8');
for (const perm of manifest.permissions ?? []) check(listing.includes(`\`${perm}\``), `listing.md justifies permission ${perm}`);
for (const host of manifest.host_permissions ?? []) check(listing.includes(host), `listing.md justifies host permission ${host}`);
check(/remote code/i.test(listing), 'listing.md has the remote-code statement');
check(listing.includes(manifest.description), 'listing.md summary equals the manifest description');

// ---- privacy policy page + landing link -----------------------------------------------------------
const pages = fs.readFileSync(path.join(root, 'worker', 'src', 'pages.ts'), 'utf8');
const index = fs.readFileSync(path.join(root, 'worker', 'src', 'index.ts'), 'utf8');
check(/export function privacyPage/.test(pages) && /case '\/privacy'/.test(index), 'gateway serves /privacy');
check(/href="\/privacy"/.test(pages), 'landing page links to /privacy');

// ---- screenshots (1280x800 or 640x400, 24-bit PNG without alpha) -----------------------------------
const shotsDir = path.join(root, 'docs', 'store', 'screenshots');
const shots = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((f) => /^[1-5]-.*\.png$/.test(f)) : [];
check(shots.length >= 1 && shots.length <= 5, `1-5 store screenshots in docs/store/screenshots (${shots.length})`);
for (const f of shots) {
  const b = fs.readFileSync(path.join(shotsDir, f));
  const [w, h, depth, colorType] = [b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]];
  check((w === 1280 && h === 800) || (w === 640 && h === 400), `${f} is ${w}x${h}`);
  check(depth === 8 && colorType === 2, `${f} is 24-bit PNG without alpha (colorType ${colorType})`);
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nStore package looks ready.');
process.exit(failures.length ? 1 : 0);
