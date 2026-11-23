# Register rendering performance

The shared register theme alternated font-size writes with scrollWidth/clientWidth reads for every numeric cell, repeating up to twelve times per value. On large tables this caused repeated synchronous browser layout after data had already arrived.

The renderer now reads column widths together, measures text with a canvas, and writes font sizes in one pass. A weak cache skips unchanged tables. The observer disconnects around its own DOM edits so its formatting does not enqueue another formatting pass. Existing compact centered cells, complete numeric values, icon labels and action handlers are retained. All pages using the shared script receive a new asset version.

Isolated synthetic Chromium tests (no user browser/session):
- Same 300-row/2,400-number table: old renderer 10.5–15.3 seconds, new renderer 0.24–0.39 seconds.
- 888-row/7,104-number table: 0.58 seconds.
- Verified row/count preservation, icon conversion, existing button handlers, automatic formatting of appended rows and resize handling.

These measurements cover browser table preparation, excluding authentication, data retrieval and network latency. No financial data, permissions or database schema changes are made.
