// One-command deploy: creates the KV namespace, deploys the Worker, pins its
// public URL, sets secrets and the allowlist, then packs the extension for it.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ALLOWED_EMAILS=a@x.com,b@y.com npm run setup
//
// Any value not given in the environment is asked for. Re-running is safe: it
// keeps the existing KV namespace and TOKEN_SECRET (unless ROTATE_TOKEN_SECRET=1).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, 'worker', 'wrangler.jsonc');
const statePath = path.join(root, 'secrets.local.json');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const wrangler = (args, input) =>
  execFileSync('npx', ['wrangler', ...args, '--config', config], {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
  });

async function ask(name, hint) {
  if (process.env[name]) return process.env[name].trim();
  return (await rl.question(`${hint}: `)).trim();
}

function setConfig(pattern, replacement) {
  const raw = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(config, raw.replace(pattern, replacement));
}

const step = (msg) => console.log(`\n▶ ${msg}`);

try {
  step('Checking Cloudflare login');
  try {
    console.log(wrangler(['whoami']).split('\n').find((l) => /logged in|associated with/i.test(l)) ?? 'ok');
  } catch {
    console.error('Not logged in. Run: npx wrangler login');
    process.exit(1);
  }

  const local = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};

  step('KV namespace for OAuth state');
  if (fs.readFileSync(config, 'utf8').includes('REPLACE_WITH_KV_ID')) {
    const out = wrangler(['kv', 'namespace', 'create', 'OAUTH_KV']);
    const id = /"id":\s*"([0-9a-f]{32})"/.exec(out)?.[1] ?? /id = "([0-9a-f]{32})"/.exec(out)?.[1];
    if (!id) throw new Error(`Could not read the KV namespace id from:\n${out}`);
    setConfig('REPLACE_WITH_KV_ID', id);
    console.log(`created ${id}`);
  } else console.log('already configured');

  const allowed = await ask('ALLOWED_EMAILS', 'Google emails allowed to use it (comma separated)');
  setConfig(/"ALLOWED_EMAILS":\s*"[^"]*"/, `"ALLOWED_EMAILS": "${allowed}"`);

  step('Deploying the Worker');
  let out = wrangler(['deploy']);
  const url = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/.exec(out)?.[0];
  if (!url) throw new Error(`Could not find the workers.dev URL in:\n${out}`);
  if (!fs.readFileSync(config, 'utf8').includes(`"PUBLIC_URL": "${url}"`)) {
    setConfig(/"PUBLIC_URL":\s*"[^"]*"/, `"PUBLIC_URL": "${url}"`);
  }
  console.log(url);

  step('Secrets');
  const clientId = await ask('GOOGLE_CLIENT_ID', `Google OAuth client ID (redirect URI: ${url}/callback)`);
  const clientSecret = await ask('GOOGLE_CLIENT_SECRET', 'Google OAuth client secret');
  if (!local.TOKEN_SECRET || process.env.ROTATE_TOKEN_SECRET === '1') local.TOKEN_SECRET = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(statePath, JSON.stringify(local, null, 2), { mode: 0o600 });
  const secrets = { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, TOKEN_SECRET: local.TOKEN_SECRET };
  wrangler(['secret', 'bulk'], JSON.stringify(secrets));
  console.log('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_SECRET set');

  step('Redeploying with the final URL');
  out = wrangler(['deploy']);
  console.log(out.split('\n').filter((l) => /Deployed|workers\.dev|Current Version/i.test(l)).join('\n'));

  step('Packing the extension');
  execFileSync('node', [path.join(root, 'scripts', 'pack-extension.mjs'), '--gateway', url], { stdio: 'inherit' });

  console.log(`\n✅ Done.
   Landing page:   ${url}
   MCP URL:        ${url}/mcp
   Extension zip:  extension/chrome-mcp-agent.zip (upload to the Chrome Web Store, or Load unpacked from extension/unpacked)
   Google OAuth:   authorized redirect URI must be ${url}/callback`);
} finally {
  rl.close();
}
