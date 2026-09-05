# Production Workflow — Removed-System Reference

## Status

The Production Workflow module was removed from the OMS application on 2026-09-05. This document records the behavior that existed immediately before removal so it can be redesigned later without treating the old implementation as the required design.

No database migration, update, delete, drop, or cleanup command was run. Existing MongoDB documents and indexes remain in place. The removed collections are dormant because the application no longer registers models, routes, socket rooms, pages, permissions, or Assistant catalog entries for them.

This archive does not describe the separate Sample Workflow record system at `/sample-workflows` and `/samples/workflow`. That feature remains available, but its former automatic Production Workflow task creation and task-control panel were removed.

## What the module did

Production Workflow was an internal task-management system for turning folder/file manifests or manual requests into assignable work. It supported:

- configurable departments and task types;
- individual tasks and folder-manifest batches;
- assignee and uploader ownership;
- due dates, priority, review, approval, upload, rework, and hold stages;
- comments, assignment history, status history, audit actors, and soft deletion;
- admin workload and deadline dashboards;
- filtered Task Board, My Tasks, Upload Pending, batch, task-type, and department pages;
- per-user, per-batch, and dashboard Socket.IO updates;
- workflow reminders and attention summaries in the notification dock;
- an automatic Sample Workflow → CAD task integration.

The module stored source-file metadata only. It did not upload the manifest files or generated output files.

## Former user surfaces

| Surface | Purpose |
| --- | --- |
| `/workflow/dashboard` | Admin counts, overdue/due workload, approval/upload queues, and user workload. |
| `/workflow/tasks` | Permission-scoped task board with filters, batch grouping, detail, and actions. |
| `/workflow/my-tasks` | Tasks assigned to the signed-in user. |
| `/workflow/upload-pending` | Approved work waiting for an assigned uploader. |
| `/workflow/batches` | Batch list/create/manage surface; later redirected to the task board. |
| `/workflow/batches/:batchId` | Batch detail, task bulk actions, cancel, and delete. |
| `/workflow/task-types` | Manager/admin task-type configuration. |
| `/workflow/departments` | Manager/admin department and membership configuration. |

The navbar exposed these under **Production Workflow**. Visibility used the `workflow` permission module. Admins could see the dashboard; manager-like roles could manage task types and departments.

## Former API

All endpoints were authenticated and mounted below `/workflow`.

### Dashboard and lookup

- `GET /dashboard`
- `GET /users`
- `GET /task-types`
- `POST /task-types`
- `PATCH /task-types/:id`
- `GET /departments`
- `POST /departments`
- `PATCH /departments/:id`

### Batches

- `POST /batches/from-folder-manifest`
- `GET /batches`
- `GET /batches/:id`
- `PATCH /batches/:id`
- `PATCH /batches/:id/tasks/bulk`
- `PATCH /batches/:id/cancel`
- `DELETE /batches/:id`

### Tasks

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `PATCH /tasks/:id/assign`
- `PATCH /tasks/:id/start`
- `PATCH /tasks/:id/submit`
- `PATCH /tasks/:id/complete`
- `PATCH /tasks/:id/review`
- `PATCH /tasks/:id/approve`
- `PATCH /tasks/:id/upload`
- `PATCH /tasks/:id/rework`
- `PATCH /tasks/:id/hold`
- `PATCH /tasks/:id/hold/approve`
- `PATCH /tasks/:id/hold/reject`
- `PATCH /tasks/:id/resume`
- `PATCH /tasks/:id/status`
- `POST /tasks/:id/comments`
- `DELETE /tasks/:id`

Manager/admin role checks protected batch edits, review, task-type configuration, and department configuration. Admin-like roles protected batch creation/deletion and the old `approve`/`delete` permission cells. Other task mutations relied on service-level ownership and transition checks after a `workflow.view` route check.

## Lifecycle behavior

The final primary task status sequence was:

`assigned → started → complete → approved → uploaded`

`uploaded` was terminal. `upload_required: false` allowed approval to be the effective end of work. Historical documents may also contain legacy statuses: `pending`, `in_progress`, `submitted`, `review`, `rework`, `completed`, `cancelled`, and `blocked`.

Additional behavior:

- Assignment stored current `assigned_to` users and appended assignment-history documents.
- Starting and completing recorded timestamps and appended status history.
- Approval prevented a user from approving their own assigned task.
- Upload could be tracked separately for each uploader through `upload_assignees` and `upload_statuses`.
- Rework could occur before or after approval, required a reason, incremented total and phase-specific counters, recorded the prior status, and optionally set a new due date.
- Hold followed `none → pending → hold`; approval remembered the prior task status and accumulated paused time; reject and resume recorded actors, comments, and timestamps.
- Task detail combined the live task with batch, type, department, assignments, status history, and non-deleted comments.
- Task deletion and batch deletion were soft deletes. Batch cancellation cancelled unfinished tasks and removed active assignments.
- Batch counts were recalculated from task states after relevant mutations.

## Batch and task generation

A folder manifest accepted at most 10,000 relative entries. Absolute paths, null bytes, `.`/`..` segments, and malformed entries were rejected. File types were classified as image, CAD, PDF, Excel, 3D, or other from extension/MIME metadata.

Supported generation modes were:

- `per_file` — one task per matching file;
- `per_direct_subfolder` — one task per direct child folder;
- legacy alias `per_sub_folder` — normalized to `per_direct_subfolder`;
- `once_per_batch` — one task for the batch;
- `manual` — no manifest-driven splitting.

The seed supplied:

| Key | Name | Mode |
| --- | --- | --- |
| `picture_cleaning` | Picture Cleaning | `per_file` for common image formats |
| `pis_creation` | PIS Creation | `once_per_batch` |
| `autocad_creation` | AutoCAD Creation | `once_per_batch` |
| `three_d_creation` | 3D Creation | `per_direct_subfolder` |
| `flat_carton_design` | Flat Carton Design | `once_per_batch` |
| `ean_sticker_creation` | EAN Sticker Creation | `once_per_batch` |

An active batch could not reuse the same normalized source folder and task-type key. Initial task status depended on assignment; assignment records and initial status-history records were created with the task set.

## Preserved database collections

These physical MongoDB collections were not modified:

| Collection | Former responsibility | Important stored data |
| --- | --- | --- |
| `workflow_batches` | Batch live state | batch number/name, normalized source folder, task-type snapshot/reference, brand, assignment mode/users, due date, counts, status, audit actors, timestamps, soft-delete flag |
| `workflow_tasks` | Task live state | task/batch IDs, type and department references, source metadata, assignees/uploaders, status, priority, deadlines, review/approval/upload actors, rework/hold state, tags, timestamps, soft-delete flag |
| `workflow_task_types` | Task-generation policy | key/name, category, default department/users/priority, auto-create mode, file-match rules, estimate, review requirement, active flag |
| `workflow_departments` | Department configuration | key/name, members, member roles/activity, audit actors, active flag |
| `workflow_task_assignments` | Assignment history | task, batch, assignee, department, active/removed/completed state, actors, timestamps, note |
| `workflow_task_status_history` | Append-only lifecycle history | task, batch, from/to status, actor, timestamp, note, metadata |
| `workflow_comments` | Task discussion/audit notes | task, batch, comment type/text, audit actors, soft-delete data, timestamps |

Existing `notifications` documents that reference `entity_type: workflow_task` or `workflow_batch` are also preserved. The remaining notification API filters them out because their former deep links no longer exist.

## Former realtime and notifications

Socket.IO authenticated users with the same access token/cookie as HTTP. It supported:

- `workflow:dashboard` rooms for privileged readers;
- `workflow:batch:<id>` rooms after task-visibility checks;
- `workflow:user:<id>` rooms for the user or privileged readers;
- `notification:user:<id>` rooms for private notification events.

Workflow services emitted task, batch, dashboard, and notification updates after mutations. The notification service generated assignment/status/comment/batch events, due/overdue reminders, approval/hold/upload queues, unread counts, and a login attention popup. Only the generic authenticated notification room and stored non-workflow notifications remain.

## Former Sample Workflow coupling

Creating a Sample Workflow attempted to find users named `Gaurav` and `Anzar`, task type `cad_files`, and department `autocad`. It then created a CAD task under Gaurav's audit identity, assigned it to Anzar, disabled upload, and calculated a due date two days ahead with a Sunday adjustment.

The Sample Workflow page searched production tasks by sample code and rendered three assumed stages: `cad_files`, `miscellaneous`, and `3d_by_cad`. It allowed start, complete, approve, rework, and comment operations. This coupling was removed; Sample Workflow records continue independently.

## Removed source areas

- Backend: `controllers/workflow`, `models/workflow`, `services/workflow`, `/routers/workflow.routes.js`, workflow helpers, seed/backfill scripts, workflow socket handlers, and the focused source-filter test.
- Frontend: workflow API client, pages, components, hook, manifest helper, socket wrapper, navbar section, routes, icons, and task controls embedded in Sample Workflow.
- Cross-cutting: workflow permission metadata, Assistant Knowledge Base collections/relations/capabilities, task-based notification queues, and workflow login popup endpoints/UI.

Git history remains the exact source archive. Restore from the parent commit of this removal rather than copying code fragments out of this document.

## What should be better in a future implementation

1. Model business corrections, not a generic task engine. The next system should begin with concrete OMS data-error cases and their owners instead of configurable workflow abstractions.
2. Use one explicit state machine. The removed code carried both primary and legacy statuses plus compatibility normalization, which made filtering and deadlines harder to reason about.
3. Remove hard-coded people and task keys. Use role/team ownership or a small database rule chosen by administrators; never search for employee names inside a controller.
4. Keep Sample Workflow independent. If it needs follow-up work, publish a domain event or create a correction case through an explicit adapter, not title-based task searches.
5. Put authorization on actions. `workflow.view` was too broad for several mutations. Define permissions such as assign, transition, approve, comment, and administer, and enforce ownership in one service.
6. Keep one authoritative record plus an append-only event trail. Current state and audit history should be updated atomically; derived dashboard counts should be queried or rebuilt, not maintained through many mutation paths.
7. Use stable entity links. Associate a case with collection/entity ID and error type; do not correlate by display titles, sample codes, or folder names.
8. Separate deadlines from lifecycle. Store deadline changes as events and calculate overdue state centrally with a named business timezone/calendar.
9. Make correction suggestions explainable. Every proposed fix should store rule ID/version, before value, proposed value, confidence, evidence, reviewer, and final decision. Never silently overwrite ambiguous data.
10. Start without batches, departments, custom task types, file manifests, dashboards, or Socket.IO. Add each only after a real correction use case requires it. A database-backed correction queue with polling is enough for the first release.

## Minimal reimplementation target

For the planned human-error correction system, begin with one collection such as `data_correction_cases`:

- affected entity type and ID;
- field/path, current value, proposed value;
- deterministic rule ID/version and evidence;
- severity and status: `open`, `accepted`, `rejected`, `fixed`;
- assigned role/user;
- detected, reviewed, and fixed actors/timestamps;
- optimistic version or source-document version for stale-write protection.

Expose a small queue/detail API and apply accepted fixes through the existing domain service in a transaction. Keep audit history append-only. Add realtime delivery, bulk operations, flexible rules, or departments only when measured usage demands them.

## Reimplementation checklist

- Confirm the first three real human-error examples and their authoritative source fields.
- Decide which errors can be blocked, auto-normalized, suggested, or only reported.
- Define correction ownership by role/team.
- Verify existing dormant documents and indexes before reusing any collection name.
- Write an explicit migration/compatibility decision; do not assume old workflow states map to correction cases.
- Reuse OMS validation, mismatch, transaction, permission, and edit-log helpers where they already own the rule.
- Add one focused end-to-end test for detection → review → atomic correction → audit.
- Update this archive with the replacement design decision; do not restore the old module wholesale by default.
