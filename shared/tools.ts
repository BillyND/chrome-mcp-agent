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
  description: 'Tab to act on. Defaults to the agent tab (see browser_tabs).',
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
      'List, open, close or select tabs. "select" makes a tab the agent tab that other tools act on by default. Always start a task by listing tabs unless the user named a URL.',
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['list', 'new', 'close', 'select'] },
        tabId: { type: 'integer', description: 'Required for close and select.' },
        url: { type: 'string', description: 'URL to open with "new".' },
      },
      ['action'],
    ),
    readOnly: false,
    timeoutMs: 20_000,
  },
  {
    name: 'browser_navigate',
    title: 'Navigate',
    description: 'Open a URL in the agent tab (or go back, forward, reload) and wait for the page to load.',
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
    description: 'Wait for text to appear or disappear anywhere on the page (all frames), or for a number of seconds.',
    inputSchema: obj({
      text: { type: 'string' },
      textGone: { type: 'string' },
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
    description: 'Console messages and uncaught errors of the agent tab since the agent attached to it.',
    inputSchema: obj({ tabId, onlyErrors: { type: 'boolean', default: false } }),
    readOnly: true,
    timeoutMs: 15_000,
  },
  {
    name: 'browser_network_requests',
    title: 'Network requests',
    description: 'Network requests of the agent tab since the agent attached to it (method, URL, status, type).',
    inputSchema: obj({ tabId, filter: { type: 'string', description: 'Only URLs containing this text.' } }),
    readOnly: true,
    timeoutMs: 15_000,
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
