// Sites blocked until the user unblocks them: banking and payments, crypto exchanges, adult
// content and the Chrome Web Store. A short curated list, not an attempt at a full category feed.

export type BlockCategory = 'banking' | 'crypto' | 'adult' | 'store';

export interface DefaultBlock {
  /** Host or parent domain; every subdomain matches too. */
  host: string;
  /** Only URLs whose path starts with this match. */
  pathPrefix?: string;
  category: BlockCategory;
}

const group = (category: BlockCategory, hosts: string[]): DefaultBlock[] => hosts.map((host) => ({ host, category }));

export const DEFAULT_BLOCKS: DefaultBlock[] = [
  ...group('banking', [
    'paypal.com', 'wise.com', 'venmo.com', 'cash.app', 'revolut.com', 'chase.com', 'bankofamerica.com', 'wellsfargo.com',
    'citi.com', 'hsbc.com', 'capitalone.com', 'americanexpress.com', 'vietcombank.com.vn', 'techcombank.com.vn',
    'vietinbank.vn', 'bidv.com.vn', 'mbbank.com.vn', 'acb.com.vn', 'tpb.vn', 'vpbank.com.vn', 'momo.vn', 'zalopay.vn', 'vnpay.vn',
  ]),
  ...group('crypto', [
    'binance.com', 'coinbase.com', 'kraken.com', 'bybit.com', 'okx.com', 'kucoin.com', 'bitfinex.com', 'gate.io', 'htx.com',
    'crypto.com', 'gemini.com',
  ]),
  ...group('adult', [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com', 'onlyfans.com', 'chaturbate.com',
    'stripchat.com', 'brazzers.com',
  ]),
  { host: 'chromewebstore.google.com', category: 'store' },
  { host: 'chrome.google.com', pathPrefix: '/webstore', category: 'store' },
];
