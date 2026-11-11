import { describe, expect, it } from 'vitest';
import { macCommands, parseShortcut } from '../extension/src/background/keys';
import { signDeviceToken, verifyDeviceToken } from '../worker/src/device-token';
import { newCode, normalizeCode } from '../worker/src/pairing';
import { TOOLS } from '../shared/tools';

const SECRET = 'unit-test-secret-0123456789abcdef0123';

describe('device tokens', () => {
  it('round-trips the device id', async () => {
    const token = await signDeviceToken(SECRET, 'Device-ABC');
    expect(await verifyDeviceToken(SECRET, token)).toBe('device-abc');
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signDeviceToken('another-secret-0123456789abcdef0123', 'a@b.c');
    expect(await verifyDeviceToken(SECRET, token)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signDeviceToken(SECRET, 'a@b.c');
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ sub: 'boss@b.c', iat: 0, exp: 9e9 })).replace(/=+$/, '');
    expect(await verifyDeviceToken(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signDeviceToken(SECRET, 'a@b.c', Date.now() - 400 * 24 * 3600 * 1000);
    expect(await verifyDeviceToken(SECRET, token)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyDeviceToken(SECRET, 'not-a-token')).toBeNull();
    expect(await verifyDeviceToken(SECRET, '')).toBeNull();
  });
});

describe('connection codes', () => {
  it('generates readable codes', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });
  it('accepts sloppy typing and rejects junk', () => {
    expect(normalizeCode('k7qx2 mn4pd')).toBe('K7QX2-MN4PD');
    expect(normalizeCode('K7QX2MN4PD')).toBe('K7QX2-MN4PD');
    expect(normalizeCode('K7QX2-MN4P')).toBeNull();
    expect(normalizeCode('K7QX2-MN4P0')).toBeNull(); // 0 is not in the alphabet
  });
});

describe('shortcuts', () => {
  it('parses modifiers and keys', () => {
    const s = parseShortcut('Control+Shift+K');
    expect(s.modifiers).toEqual(['Control', 'Shift']);
    expect(s.key.code).toBe('KeyK');
    expect(parseShortcut('Enter').key.keyCode).toBe(13);
    expect(parseShortcut('cmd+a').modifiers).toEqual(['Meta']);
    expect(parseShortcut('Control++').key.key).toBe('+');
  });
  it('rejects unknown names with a helpful message', () => {
    expect(() => parseShortcut('Hyper+K')).toThrow(/Unknown modifier/);
    expect(() => parseShortcut('Banana')).toThrow(/Unknown key/);
  });
  it('maps macOS editing shortcuts to commands', () => {
    expect(macCommands(['Meta'], parseShortcut('a').key)).toEqual(['selectAll']);
    expect(macCommands(['Meta', 'Shift'], parseShortcut('z').key)).toEqual(['redo']);
    expect(macCommands(['Control'], parseShortcut('a').key)).toBeUndefined();
  });
});

describe('tool catalog', () => {
  it('has unique, spec-valid names and object schemas', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect((t.inputSchema as { type: string }).type).toBe('object');
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});
