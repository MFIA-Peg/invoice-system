# Seven financial summary cards

All financial summaries use the same seven cards. Summary scope includes open and closed records within the selected customer, department, project, PO and status/search dimensions. Default tables remain in their existing open/closed view; selecting a card displays its contributors and clearing the card restores the normal table view.

| Card | Amount | Date basis |
| --- | --- | --- |
| Billing Incl VAT | Issued/approved invoice face value including VAT; Ex VAT and VAT appear together on its subline | Actual approval date inside the period; no issue/due-date fallback |
| Collections | Actual invoice collection transactions, excluding PO advance receipts | Collection date inside the period |
| Advances Received | Actual receipts recorded in the PO advance ledger, once each | Actual payment date inside the period |
| Net Collectible | Current remaining cash collectible after recorded payments, allocated advances and unreleased retention | Invoice due date inside the period |
| Pending Approval | Current waiting-approval invoices including VAT | No historical period filter |
| Retention | Current unreleased retention balance | Invoice approval date inside the period |
| Draft | Current draft invoices including VAT, with invoice date on or before the query date | Query date in Asia/Riyadh, independent of the selected period |

No approval-date fallback is inferred for billing or retention. Future drafts are excluded until their invoice date arrives. Undated drafts and legacy undated advances are excluded from date-based totals and explicitly indicated for review. The current year is the default period; an explicit selected period can cover other years.

These cards have different date bases and are independent measures, not seven components to add together. Pending and draft invoices are not included in issued billing. Contract advances are not added to invoice collections. Net collectible excludes unreleased retention and advance amounts already allocated to invoices. Stored invoice/PO values and existing payment records are not rewritten by the summaries.

PO advance receipts require an actual payment date and follow scoped Collection permissions. Adding, changing or deleting a receipt updates the PO's read-only advance aggregate in the same database transaction. Existing undated aggregates are preserved without inventing dates. The migration found no nonzero legacy advances.
