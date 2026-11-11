# Real-site suite results (tests/real-sites.e2e.ts)

Run: `REAL_SITES=1 E2E_PORT=8815 E2E_FIXTURE_PORT=4700 HELMSMAN_PORT=47915 npx playwright test tests/real-sites.e2e.ts`
(after merging main with the evaluate prompt, mouse_xy classification and screenshot masking; `script:<host>` rules pre-seeded). 14 passed, 0 skipped, no retries needed in the final run.

| Site | Scenario | Result | Bug found / fixed |
|---|---|---|---|
| en.wikipedia.org | type in search + submit, follow link, find text, extract infobox table, scroll | pass | the first cold run of a fresh browser failed twice to leave Main_Page (retry passed, not reproducible in isolation); flake, not fixed |
| httpbin.org/forms/post | fill_form (text, radio, checkboxes, textarea), submit, verify echoed JSON | pass | none |
| interactive-examples.mdn.mozilla.net (cross-origin iframe) | edit CodeMirror in the iframe, click Run, read output | pass | none |
| developer.mozilla.org/play (mdnplay.dev runner iframe) | type HTML/JS, Run, click a button inside the cross-origin runner | pass | none |
| shoelace.style | click sl-button inside shadow roots, open/close sl-dialog, toggle sl-checkbox | pass | `browser_wait_for {selector}` cannot match a `display:contents` host (zero box); noted in the test, not changed |
| react.dev | open search dialog, type, ArrowDown, Enter, Ctrl+K / Escape | pass | none |
| docs.google.com (public sheet, view only) | canvas in snapshot, screenshot, mouse_xy selects C3 and A2, formula bar read via browser_find | pass | none |
| excalidraw.com (canvas app) | shortcut keys, drag rectangle and ellipse with mouse_xy, screenshot | pass | none |
| the-internet /dropdown, /checkboxes | select option, checkbox click | pass | none |
| the-internet /upload, /download | file upload (base64), click Upload, browser_download | pass | none |
| the-internet /javascript_alerts | alert, confirm (dismiss), prompt with text | pass | none |
| the-internet /nested_frames | frameset in frameset: LEFT/MIDDLE/RIGHT/BOTTOM in snapshot, find, get_text | pass | none (frames must have loaded; the test waits) |
| the-internet /drag_and_drop | HTML5 drag A onto B swaps columns | pass | none |
| the-internet /infinite_scroll, /dynamic_loading/2 | scroll loads more, wait_for selector, selectorGone | pass | **fixed**: `browser_wait_for selectorGone` treated hidden (`display:none`) elements as still present and timed out; it now means "no visible match", as the tool description says (extension/src/background/tools/wait.ts) |

Google Docs read-only view: no stable public doc id is known, so canvas coverage uses a public Google Sheet and Excalidraw.
Unreachable sites: none from this machine.
