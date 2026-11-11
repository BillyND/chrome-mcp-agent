// browser_emulate: device size, user agent, colour scheme, timezone and network conditions of one tab.

import { pinSession, send } from '../cdp';
import { pageHeader, prepareTab } from './tab';
import { tabTool, text, ToolError } from './types';

interface Device {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent?: string;
}

const DEVICES: Record<string, Device> = {
  iphone: {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  android: {
    width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  },
  ipad: {
    width: 820, height: 1180, deviceScaleFactor: 2, mobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
};

/** latency in ms, throughput in kilobits per second. */
const NETWORKS: Record<string, { latency: number; down: number; up: number }> = {
  'slow-3g': { latency: 2000, down: 400, up: 400 },
  'fast-3g': { latency: 562, down: 1600, up: 750 },
  '4g': { latency: 170, down: 9000, up: 1500 },
};

/** What is currently overridden per tab, so results can say so. */
const active = new Map<number, Map<string, string>>();
chrome.tabs.onRemoved.addListener((tabId) => active.delete(tabId));

const describeState = (tabId: number) => {
  const state = active.get(tabId);
  return state?.size ? [...state].map(([k, v]) => `${k}: ${v}`).join('; ') : 'none (normal browsing)';
};

async function reset(tabId: number) {
  await Promise.all([
    send(tabId, 'Emulation.clearDeviceMetricsOverride'),
    send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }),
    send(tabId, 'Emulation.setUserAgentOverride', { userAgent: '' }),
    send(tabId, 'Emulation.setEmulatedMedia', { features: [] }),
    send(tabId, 'Emulation.setTimezoneOverride', { timezoneId: '' }),
    send(tabId, 'Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
  ]);
  active.delete(tabId);
  pinSession(tabId, false);
}

export const emulationTools = {
  browser_emulate: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Giả lập');
    const tabId = tab.id!;
    if (args.reset) {
      await reset(tabId);
      return text(`${await pageHeader(tab)}\nEmulation reset.`);
    }
    const state = active.get(tabId) ?? new Map<string, string>();
    const device = args.device ? DEVICES[String(args.device)] : undefined;
    if (args.device && args.device !== 'desktop' && !device) throw new ToolError('device must be one of desktop, iphone, android, ipad.');

    if (args.device === 'desktop') {
      await Promise.all([
        send(tabId, 'Emulation.clearDeviceMetricsOverride'),
        send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }),
        send(tabId, 'Emulation.setUserAgentOverride', { userAgent: '' }),
      ]);
      state.delete('viewport');
      state.delete('userAgent');
    }
    if (device || args.width !== undefined || args.height !== undefined) {
      const width = Number(args.width ?? device?.width ?? 1280);
      const height = Number(args.height ?? device?.height ?? 800);
      const mobile = args.mobile ?? device?.mobile ?? false;
      await send(tabId, 'Emulation.setDeviceMetricsOverride', {
        width, height, mobile: !!mobile, deviceScaleFactor: Number(args.deviceScaleFactor ?? device?.deviceScaleFactor ?? 0),
      });
      await send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: !!mobile });
      state.set('viewport', `${width}x${height}${mobile ? ' mobile' : ''}`);
    }
    const userAgent = args.userAgent ?? device?.userAgent;
    if (userAgent) {
      await send(tabId, 'Emulation.setUserAgentOverride', { userAgent: String(userAgent) });
      state.set('userAgent', String(userAgent).slice(0, 60));
    }
    if (args.colorScheme) {
      const scheme = String(args.colorScheme);
      await send(tabId, 'Emulation.setEmulatedMedia', { features: scheme === 'none' ? [] : [{ name: 'prefers-color-scheme', value: scheme }] });
      scheme === 'none' ? state.delete('colorScheme') : state.set('colorScheme', scheme);
    }
    if (args.timezone) {
      await send(tabId, 'Emulation.setTimezoneOverride', { timezoneId: String(args.timezone) });
      state.set('timezone', String(args.timezone));
    }
    if (args.offline !== undefined || args.network) {
      const preset = args.network && args.network !== 'none' ? NETWORKS[String(args.network)] : undefined;
      if (args.network && args.network !== 'none' && !preset) throw new ToolError('network must be one of none, slow-3g, fast-3g, 4g.');
      const offline = !!args.offline;
      await send(tabId, 'Network.emulateNetworkConditions', {
        offline,
        latency: preset?.latency ?? 0,
        downloadThroughput: preset ? preset.down * 125 : -1,
        uploadThroughput: preset ? preset.up * 125 : -1,
      });
      offline || preset ? state.set('network', offline ? 'offline' : String(args.network)) : state.delete('network');
    }
    active.set(tabId, state);
    pinSession(tabId, state.size > 0);
    return text(`${await pageHeader(tab)}\nEmulation now: ${describeState(tabId)}. Reload the page (browser_navigate action "reload") to apply the user agent to the page's requests; use reset:true to undo.`);
  }),
};
