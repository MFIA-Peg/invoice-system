# Purchase order reassignment

The PO editor uses searchable registered Department, Customer and Project lists. Departments are limited to editable scope; customers follow department links, and projects follow the selected customer/department. Existing assignments load without silent replacement.

Existing POs save through update_purchase_order. The RPC validates source and destination scope, project context, registered customer/department relationships, duplicate PO numbers and allowed fields. Reassigning linked invoices also requires Invoice Edit permission. Updates run atomically with invoice and collection writes serialized and normal synchronization/protection triggers enabled. Temporary parking PO links allow the protected original PO to retain its ID while invoices move to the new number/project; no temporary records persist after commit.

Completed and retention invoices keep their IDs, financial fields and collection records. Link changes are audited. Direct uncoordinated link updates remain blocked. Editing only links does not rerun invoice advance amortisation; the existing recalculation is used only when PO value or advance percentage changes.

Validation: rolled-back synthetic authenticated SQL tests cover manager/Editor reassignment, completed and retention invoices, preserved receipt IDs/amounts, duplicate rejection, direct-trigger protection, destination permission denial and Viewer denial. Isolated synthetic browser tests use the actual PO form, lookup scripts and searchable adapter to verify cascading choices, atomic RPC payload and absence of advance recalculation on link-only edits. No real PO is reassigned during deployment.
