# Fast invoice and PO registers

Both register pages render fifty records at a time, with Previous/Next controls. Search and filters still cover all loaded records. KPIs, charts and CSV export use the complete filtered result set. Invoice action indices retain the global filtered offset, so actions on later pages target the correct invoice.

Invoice-specific per-cell font shrinking and its ResizeObserver were removed. These pages use static compact numeric fonts and fixed table layout, and opt out of the shared geometry/font sizing pass. Small viewports can scroll horizontally to retain complete values. Other screens retain their existing formatting.

Local session retrieval avoids an extra Auth user request. The current server-side profile and module-access checks execute together; register data loads concurrently. Results render only after session/profile/module checks succeed. All Data API requests retain current RLS enforcement. Prepared data is reused only for that page's initial load and cleared after completion; Refresh obtains fresh data.

Validation: isolated complete-page Chromium tests use actual page HTML, real shared scripts/styles, 888 synthetic invoices, 366 POs, 141 projects and 250ms latency per backend operation. The new pages displayed in approximately 0.8–1.5 seconds in these tests. Verified 50-row rendering, page navigation, unchanged full-result KPIs, search for the last record, filter/page reset, a single invoice-data request and correct second-page invoice actions. JavaScript sources parse and no browser script errors occurred. These are synthetic measurements and exclude live CDN/network variability; no real browser session or financial data was used.
