// Tool catalog shared by the gateway (advertises it over MCP) and the extension
// (executes it). Keep names and arguments close to Playwright MCP so models that
// already know that toolset use this one without extra prompting.

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** How long the gateway waits for the extension before giving up. */
  timeoutMs: number;
}

const ref = {
  type: 'string',
  description:
    'Element reference from the latest browser_snapshot, e.g. "e12" or "f3e7" for an element inside an iframe.',
};
const element = {
  type: 'string',
  description: 'Short human-readable description of the element, shown to the user while the agent works.',
};
const tabId = {
  type: 'integer',
  description:
    'Tab to act on. Defaults to your own default tab (see browser_tabs). Calls on different tabs run in parallel; calls on the same tab run one after another.',
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS: ToolDef[] = [
  {
    name: 'browser_tabs',
    title: 'Tabs',
    description:
      'List, open, close or select tabs. Each AI agent has its own default tab and its own Chrome tab group, so several agents can work side by side. "new" opens a tab of your own (in the background); "select" makes an existing tab your default. Pass tabId to other tools to work in several tabs in parallel. Start a task by listing tabs unless the user named a URL.',
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['list', 'new', 'close', 'select'] },
        tabId: { type: 'integer', description: 'Required for close and select.' },
        url: { type: 'string', description: 'URL to open with "new".' },
        activate: { type: 'boolean', default: false, description: 'With "new" or "select": also bring the tab to the front of the browser (off by default so other agents and the user are not disturbed).' },
      },
      ['action'],
    ),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_navigate',
    title: 'Navigate',
    description: 'Open a URL in the tab (or go back, forward, reload) and wait for the page to load.',
    inputSchema: obj({
      url: { type: 'string', description: 'URL to open. Omit when using action.' },
      action: { type: 'string', enum: ['goto', 'back', 'forward', 'reload'], default: 'goto' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 45_000,
  },
  {
    name: 'browser_snapshot',
    title: 'Page snapshot',
    description:
      'Read the page as an accessibility tree with element refs, including the content of every iframe (same-origin and cross-origin). Use refs from the latest snapshot for every other action. Prefer this over screenshots.',
    inputSchema: obj({
      tabId,
      maxChars: { type: 'integer', description: 'Truncate the snapshot after this many characters (default 60000).' },
    }),
    readOnly: true,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_click',
    title: 'Click',
    description: 'Click an element with a real mouse event. Works inside iframes. Supports double and right click and modifier keys.',
    inputSchema: obj(
      {
        element,
        ref,
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        doubleClick: { type: 'boolean', default: false },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
        tabId,
      },
      ['ref'],
    ),
    readOnly: false,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_hover',
    title: 'Hover',
    description: 'Move the mouse over an element (opens hover menus and tooltips).',
    inputSchema: obj({ element, ref, tabId }, ['ref']),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_type',
    title: 'Type text',
    description:
      'Type text with real keyboard input. With ref: click into that field first (inputs, textareas, rich text editors, fields inside iframes). Without ref: type into whatever has focus, e.g. the selected cell in Google Sheets after browser_mouse_xy.',
    inputSchema: obj(
      {
        element,
        ref,
        text: { type: 'string' },
        clear: { type: 'boolean', default: true, description: 'With ref: select and replace the existing value first.' },
        submit: { type: 'boolean', default: false, description: 'Press Enter afterwards.' },
        slowly: { type: 'boolean', default: false, description: 'Type one key at a time (for fields that react per key).' },
        tabId,
      },
      ['text'],
    ),
    readOnly: false,
    timeoutMs: 60_000,
  },
  {
    name: 'browser_mouse_xy',
    title: 'Mouse at coordinates',
    description:
      'Click, double-click, right-click, move or drag at pixel coordinates. Use it for things a snapshot cannot address: canvas apps (Google Sheets cells, maps, charts, games, editors drawn on canvas) and unlabeled spots. Take browser_screenshot first: its pixels are viewport CSS pixels, so x/y read off the image work directly. Or pass ref (e.g. a canvas, even inside an iframe) and x/y relative to that element\'s top-left corner.',
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'move', 'drag'], default: 'click' },
        x: { type: 'number' },
        y: { type: 'number' },
        toX: { type: 'number', description: 'Drag end x (same coordinate space as x).' },
        toY: { type: 'number', description: 'Drag end y.' },
        ref: { ...ref, description: 'Optional element whose top-left corner is the origin for x/y (and toX/toY).' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
        tabId,
      },
      ['x', 'y'],
    ),
    readOnly: false,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_fill_form',
    title: 'Fill form',
    description:
      'Fill several fields at once: text inputs, textareas, checkboxes, radios and selects. Faster than repeated browser_type calls.',
    inputSchema: obj(
      {
        fields: {
          type: 'array',
          items: obj(
            {
              ref,
              element,
              value: {
                type: ['string', 'boolean', 'array'],
                items: { type: 'string' },
                description: 'Text for inputs, true/false for checkboxes and radios, option label(s) or value(s) for selects.',
              },
            },
            ['ref', 'value'],
          ),
        },
        tabId,
      },
      ['fields'],
    ),
    readOnly: false,
    timeoutMs: 60_000,
  },
  {
    name: 'browser_select_option',
    title: 'Select option',
    description: 'Choose option(s) in a <select> element by label or value.',
    inputSchema: obj(
      { element, ref, values: { type: 'array', items: { type: 'string' } }, tabId },
      ['ref', 'values'],
    ),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_press_key',
    title: 'Press key',
    description:
      'Press a key or shortcut on the focused element, e.g. "Enter", "Escape", "ArrowDown", "Tab", "Control+a", "Meta+Shift+K".',
    inputSchema: obj({ key: { type: 'string' }, tabId }, ['key']),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_scroll',
    title: 'Scroll',
    description:
      'Scroll the page or a scrollable element (by ref) with the mouse wheel. Use direction and amount in pixels, or toRef to bring an element into view.',
    inputSchema: obj({
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right'], default: 'down' },
      amount: { type: 'integer', default: 600 },
      ref: { ...ref, description: 'Scroll inside this element (it can be in an iframe). Defaults to the page.' },
      toRef: { ...ref, description: 'Scroll until this element is visible.' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_drag',
    title: 'Drag and drop',
    description: 'Drag one element onto another with real mouse movement.',
    inputSchema: obj(
      { startRef: ref, startElement: element, endRef: ref, endElement: element, tabId },
      ['startRef', 'endRef'],
    ),
    readOnly: false,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_screenshot',
    title: 'Screenshot',
    description:
      'Capture the visible viewport, the full page, or one element (by ref). Viewport screenshots use 1 image pixel = 1 CSS pixel, so coordinates read off the image can be passed straight to browser_mouse_xy.',
    inputSchema: obj({
      ref: { ...ref, description: 'Capture only this element.' },
      fullPage: { type: 'boolean', default: false },
      tabId,
    }),
    readOnly: true,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_get_text',
    title: 'Read text',
    description:
      'Read the readable text of the page (all frames) or of one element. Good for long articles, tables and emails.',
    inputSchema: obj({
      ref: { ...ref, description: 'Read only this element.' },
      maxChars: { type: 'integer', description: 'Default 40000.' },
      tabId,
    }),
    readOnly: true,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_evaluate',
    title: 'Run JavaScript',
    description:
      'Run a JavaScript expression or function body in the page (or in the frame that contains ref, with the element available as `element`). Return a JSON-serializable value.',
    inputSchema: obj(
      {
        script: { type: 'string', description: 'E.g. "document.title" or "return [...document.links].length".' },
        ref: { ...ref, description: 'Run in the frame of this element and pass it as `element`.' },
        tabId,
      },
      ['script'],
    ),
    readOnly: false,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_wait_for',
    title: 'Wait',
    description:
      'Wait until text appears or disappears anywhere on the page (all frames), a CSS selector appears or disappears, and/or the network is idle (no requests in flight for 0.5s); or wait a number of seconds. Conditions combine: all must hold.',
    inputSchema: obj({
      text: { type: 'string' },
      textGone: { type: 'string' },
      selector: { type: 'string', description: 'CSS selector that must match a visible element (open shadow roots and all frames are searched).' },
      selectorGone: { type: 'string', description: 'CSS selector that must no longer match a visible element.' },
      networkIdle: { type: 'boolean', default: false, description: 'Wait until no network request has been in flight for 0.5 seconds.' },
      time: { type: 'number', description: 'Seconds to wait (max 30).' },
      timeout: { type: 'number', description: 'Max seconds to wait for text (default 20, max 50).' },
      tabId,
    }),
    readOnly: true,
    timeoutMs: 60_000,
  },
  {
    name: 'browser_handle_dialog',
    title: 'Handle dialog',
    description: 'Accept or dismiss the open alert/confirm/prompt/beforeunload dialog.',
    inputSchema: obj(
      { accept: { type: 'boolean' }, promptText: { type: 'string' }, tabId },
      ['accept'],
    ),
    readOnly: false,
    timeoutMs: 15_000,
  },
  {
    name: 'browser_file_upload',
    title: 'Upload file',
    description:
      'Attach files to a file input (by ref). Each file comes from a URL the browser can download or from base64 content.',
    inputSchema: obj(
      {
        ref,
        element,
        files: {
          type: 'array',
          items: obj(
            {
              name: { type: 'string' },
              mimeType: { type: 'string' },
              url: { type: 'string' },
              base64: { type: 'string' },
            },
            ['name'],
          ),
        },
        tabId,
      },
      ['ref', 'files'],
    ),
    readOnly: false,
    timeoutMs: 60_000,
  },
  {
    name: 'browser_download',
    title: 'Download',
    description: "Download a URL to the user's Downloads folder using the browser's own cookies.",
    inputSchema: obj({ url: { type: 'string' }, filename: { type: 'string' } }, ['url']),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_console_messages',
    title: 'Console messages',
    description: 'Console messages and uncaught errors of the tab since the agent attached to it.',
    inputSchema: obj({ tabId, onlyErrors: { type: 'boolean', default: false } }),
    readOnly: true,
    timeoutMs: 15_000,
  },
  {
    name: 'browser_network_requests',
    title: 'Network requests',
    description: 'Network requests of the tab since the agent attached to it (method, URL, status, type).',
    inputSchema: obj({ tabId, filter: { type: 'string', description: 'Only URLs containing this text.' } }),
    readOnly: true,
    timeoutMs: 15_000,
  },
  {
    name: 'browser_find',
    title: 'Find text',
    description:
      'Find visible text on the page, including inside iframes and shadow DOM, and return a ref for each match (the nearest clickable element when there is one) with a snippet. Cheaper than a full snapshot when you know what you are looking for.',
    inputSchema: obj(
      {
        text: { type: 'string', description: 'Text to look for (case-insensitive unless caseSensitive).' },
        caseSensitive: { type: 'boolean', default: false },
        maxResults: { type: 'integer', description: 'Default 20, max 100.' },
        tabId,
      },
      ['text'],
    ),
    readOnly: true,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_extract',
    title: 'Extract structured data',
    description:
      'Return structured data from the page as JSON: links (text, href, ref), tables (headers and rows), headings, forms with their fields, and page metadata (title, description, canonical, Open Graph). All frames are included. Pass ref to limit it to one element.',
    inputSchema: obj({
      what: {
        type: 'array',
        items: { type: 'string', enum: ['links', 'tables', 'headings', 'forms', 'meta'] },
        description: 'Which kinds of data to return. Default: all of them.',
      },
      ref: { ...ref, description: 'Only extract from inside this element.' },
      maxItems: { type: 'integer', description: 'Max items per kind (default 100, max 500).' },
      maxChars: { type: 'integer', description: 'Truncate the JSON after this many characters (default 40000).' },
      tabId,
    }),
    readOnly: true,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_pdf',
    title: 'Save page as PDF',
    description:
      'Render the page to a PDF. By default it is saved to the Downloads folder and the path is returned; set returnBase64 to get the bytes inline instead (small documents only).',
    inputSchema: obj({
      filename: { type: 'string', description: 'File name in Downloads (default page.pdf).' },
      format: { type: 'string', enum: ['A4', 'Letter'], default: 'A4' },
      landscape: { type: 'boolean', default: false },
      printBackground: { type: 'boolean', default: true },
      pageRanges: { type: 'string', description: 'E.g. "1-3, 5".' },
      returnBase64: { type: 'boolean', default: false },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 60_000,
  },
  {
    name: 'browser_emulate',
    title: 'Emulate device',
    description:
      'Change how one tab looks to the page: device preset or viewport size, mobile mode, user agent, light/dark colour scheme, timezone, offline mode and network speed. Applies to that tab only until reset:true. Call it with no options to see the current state.',
    inputSchema: obj({
      device: { type: 'string', enum: ['desktop', 'iphone', 'android', 'ipad'], description: '"desktop" removes the viewport and user agent override.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      deviceScaleFactor: { type: 'number' },
      mobile: { type: 'boolean' },
      userAgent: { type: 'string' },
      colorScheme: { type: 'string', enum: ['light', 'dark', 'none'] },
      timezone: { type: 'string', description: 'IANA name, e.g. "Asia/Tokyo".' },
      offline: { type: 'boolean' },
      network: { type: 'string', enum: ['none', 'slow-3g', 'fast-3g', '4g'] },
      reset: { type: 'boolean', default: false, description: 'Remove every override from the tab.' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_cookies',
    title: 'Cookies',
    description:
      "Read, set or delete browser cookies for a URL (default: the current tab's site) or domain. These are the user's real cookies, including login sessions: touch them only when the task needs it.",
    inputSchema: obj({
      action: { type: 'string', enum: ['get', 'set', 'delete'], default: 'get' },
      url: { type: 'string', description: "Site the cookie belongs to. Defaults to the current tab's URL." },
      domain: { type: 'string', description: 'Match or set by domain instead of URL, e.g. ".example.com".' },
      name: { type: 'string', description: 'Cookie name (required for set and delete; filters get).' },
      value: { type: 'string', description: 'Cookie value (set).' },
      path: { type: 'string' },
      secure: { type: 'boolean' },
      httpOnly: { type: 'boolean' },
      sameSite: { type: 'string', enum: ['no_restriction', 'lax', 'strict'] },
      expiresInDays: { type: 'number', description: 'Set: lifetime; omit for a session cookie.' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_history',
    title: 'Browsing history',
    description: "Search the user's browsing history by text (title or URL), newest first.",
    inputSchema: obj({
      text: { type: 'string', description: 'Search text; omit for the most recent pages.' },
      days: { type: 'number', description: 'How far back to look (default 30).' },
      maxResults: { type: 'integer', description: 'Default 20, max 100.' },
    }),
    readOnly: true,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_windows',
    title: 'Windows',
    description:
      'List, open, close or focus browser windows. A new window opens in the background unless focused is true; its first tab becomes your default tab.',
    inputSchema: obj({
      action: { type: 'string', enum: ['list', 'new', 'close', 'focus'], default: 'list' },
      windowId: { type: 'integer', description: 'Required for close and focus.' },
      url: { type: 'string', description: 'URL to open with "new".' },
      focused: { type: 'boolean', default: false },
      incognito: { type: 'boolean', description: 'Needs "Allow in Incognito" for this extension.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      state: { type: 'string', enum: ['normal', 'minimized', 'maximized', 'fullscreen'] },
    }),
    readOnly: false,
    timeoutMs: 30_000,
  },
  {
    name: 'browser_select_text',
    title: 'Select text',
    description:
      'Select text on the page: all the text of an element (ref), or the first occurrence of a phrase (optionally inside a ref). Returns the selected text; follow with browser_clipboard "copy" to keep it.',
    inputSchema: obj({
      text: { type: 'string', description: 'Phrase to select. Omit with ref to select the whole element.' },
      ref: { ...ref, description: 'Element to select in, or select entirely.' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_clipboard',
    title: 'Clipboard',
    description:
      'Your own clipboard (not shared with other agents): "copy" stores the current selection or the given text, "paste" types it into the focused element or into ref, "read" returns it.',
    inputSchema: obj({
      action: { type: 'string', enum: ['copy', 'paste', 'read'], default: 'read' },
      text: { type: 'string', description: 'copy: store this instead of the selection. paste: paste this instead of the clipboard.' },
      ref: { ...ref, description: 'paste: click into this field first (appends at the end).' },
      tabId,
    }),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_request_user',
    title: 'Ask the user to take over',
    description:
      'Hand the tab to the user for something only they should do: logging in, solving a CAPTCHA, entering payment or identity details, or any step you are not allowed to do. It brings the tab to the front, shows "Agent needs you" with a Done button, and waits until the user presses Done (or declines, or 10 minutes pass). Never type passwords, card numbers or CAPTCHA answers yourself; call this instead, then take a new snapshot.',
    inputSchema: obj(
      {
        reason: { type: 'string', description: 'One short sentence telling the user what to do, e.g. "Log in to your account, then press Done."' },
        tabId,
      },
      ['reason'],
    ),
    readOnly: false,
    timeoutMs: 600_000,
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
