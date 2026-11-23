# System Administration

The Finance Manager remains the protected System Administrator. The page has User Management and Data Management tabs.

## User profiles
- Viewer opens Dashboard and Reports only. Choose Customers, Departments, Projects or Purchase Orders, then select the monitored records. All write operations are denied in the database.
- Editor selects departments and Add, Edit and Delete for each department. Newly checked departments initially include all registered linked customers and projects; individual selections can be cleared. Shared customers are selected independently within each department.
- Purchase orders, invoices and collections inherit the department operations and selected customer/project scope.
- Existing profiles retain their current access until saved through System Administration. Saving applies the displayed department tree. The Finance Manager account, activation and password-change requirements are protected.
- Existing user creation, password reset and account removal flows remain available.

## Data merges
Choose Customers, Projects or Departments, search for source and destination, preview, acknowledge source removal and confirm. Only the Finance Manager can preview or execute merges.
The preview is invalidated when relevant records change. Conflicts in invoice/PO references block execution. Cross-department project moves require a review of Editor scope.
Normal synchronization and protection triggers remain active. Invoice/payment IDs, original PO IDs/numbers and financial values are preserved, including completed and retention invoices. Source records are removed only after linked records transfer within one transaction. Audit records retain a before snapshot and result.
When departments merge, existing destination operation flags take precedence over transferred flags.

## Validation
- JavaScript syntax parsed for all changed pages and scripts.
- Isolated synthetic browser tests: department auto-selection, per-department shared-customer exclusion, inherited operations, Viewer save payload, searchable merge selections, escaped preview, explicit confirmation/token and Viewer screen denial.
- Rolled-back authenticated database tests: all four Viewer monitoring types, department-specific writes, customer exclusions, own-scope creation, no self-escalation, protected Finance Manager, stale preview rejection, and all three merge types with financial comparisons.
- Deployment asserts existing business records, profiles, permissions and assigned scopes are unchanged. No production data merges or profile conversions run during deployment.
