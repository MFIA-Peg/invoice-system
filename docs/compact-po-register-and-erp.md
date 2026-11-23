# Department and purchase-order register simplification

Departments now show only the financial totals at the top; the Accessible Departments, Linked Customers and Customer Assignments cards are removed. Action buttons use icons with accessible labels/tooltips; handlers and permissions remain unchanged.

The PO register shows PO number, ERP Code, customer, department, project, value before VAT, issued invoicing before VAT, PO balance, one PO status and actions. It renders 50 orders per page, without the previous matching-count line or explanatory paragraph. Three summary fields total the complete filtered result set.

PO status combines workflow and date validity. Issued invoices exclude Draft/cancelled/canceled/void rows. A positive-value PO becomes Completed when issued invoicing reaches its value within currency precision, and automatically appears in Closed Records. Expiry is inclusive of the listed end date. Draft/cancelled invoices never complete a PO, and zero-value POs are not automatically completed. This is a derived classification: financial records and manually archived states are preserved; invoice collection/retention closure rules are unchanged. No separate balance-status column is created.

ERP Code is an optional text field on pos, present in create/edit, the register, search and export. The protected atomic update RPC accepts it and retains existing authorization/link checks.

Excel export is a real XLSX workbook with every stored PO field and derived financial fields for all filtered records across all pages. It includes fields hidden from the compact register, real date cells, two-decimal financial formatting, frozen headers and filters. ERP codes remain text, preserving leading zeros. Text is written as inline strings, never formulas.

Validation: browser tests verify 50-row pagination, complete 63-row filtered exports from the second page, hidden columns/ERP, completed-vs-open views, expired status, draft/cancelled exclusions, removed department cards and accessible action icons. Openpyxl loads the generated XLSX and verifies row count, ERP text/leading zeros, date cells, notes, frozen headers and autofilter. Authenticated rolled-back SQL tests verify ERP persistence without modifying invoices and the existing PO reassignment/permission checks. The actual PO editor test verifies ERP in the atomic save payload.
