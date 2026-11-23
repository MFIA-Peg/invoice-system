# Faster page loading

Removes repeated requests while keeping data scope and permissions unchanged:
- Initial page authorization reads reuse a completed result for at most five seconds in page memory, separately for each client. Database checks remain authoritative on every read/write.
- Projects, Purchase Orders, Invoices and Reports share their already requested financial invoice rows with annual analytics, avoiding a second invoice request.
- Departments reuse annual analytics project/PO/invoice data instead of downloading the same tables again.

Authorization performance:
- Statement-wide password-change and actor checks use scalar subqueries so PostgreSQL evaluates them once per statement.
- The manager does not compute per-customer operation flags because the protected manager already has full access. Viewer does not compute edit/delete flags it cannot use.
- No row filters, account grants or financial formulas are relaxed.

Validation:
- 23 JavaScript sources parsed.
- Tests verify request reuse/expiry/client separation, identical annual totals including retention, and error handling without partial data.
- Authenticated before/after database comparisons verify identical invoice/collection results and effective permissions for manager/editor, and enforce the mandatory-password-change gate.
- Raw and financial-view invoice values matched across 888 records.
- Representative database execution: financial view 165ms to 31ms; manager access metadata 429ms to 15ms. These measure SQL execution, not complete browser/network latency.
