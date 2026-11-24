# Gross financial summaries

All financial summary values include the VAT applicable to the individual purchase order. Stored ex-VAT contract amounts, invoice entry fields, payment records and access policies are unchanged.

For one issued invoice, the full invoice total reconciles to five separate amount components:

`Invoice total = settled against invoice + advance allocated (including its VAT) + not yet due collectible + overdue collectible + unreleased retention`

An invoice can contribute partial amounts to different components; no amount is counted in two components. The invoice total is a control total, not another component to add to that equation. Cash paid and released retention are capped at the remaining payable amount for this breakdown. Retention-only invoices allocate their remaining balance to retention alone.

Draft and Waiting For approval are separate workflow totals and are excluded from issued billing, issued receivables and contract invoicing. Canceled invoices are excluded. Bad Debit remains an issued classification; no write-off or receipt is created by changing its label.

Actual cash received during the selected payment period comes only from dated collection records. It is a separate cash-flow measure and is not added to the invoice reconciliation. Undated PO advance receipts are not added again to invoice collections.

Annual invoice summaries use due date, falling back to invoice date only when a due date is absent. Draft/waiting summaries use invoice date. Cash uses collection date. Register filters and open/closed view scope continue to apply. History tables are identified separately from annual KPIs; comparisons require matching period, filters and view.

PO display totals include VAT; internal contract completion still uses original ex-VAT contract invoicing. Advance amortisation does not reduce contract invoicing. Actual overbilling is retained rather than capped at the contract value.

Customer/department attribution resolves the invoice's PO ID first and falls back to its PO number and project. Client records are counted once per primary key.
