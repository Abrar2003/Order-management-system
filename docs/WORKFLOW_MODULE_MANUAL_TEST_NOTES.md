# Workflow Module Manual Test Notes

These notes cover the backend-only manual checks for the OMS workflow module.

## 1. Seed default task types

```bash
cd /home/abrar/repos/oms/backend
npm run seed:workflow-task-types
```

Expected:

- `picture_cleaning`
- `pis_creation`
- `autocad_creation`
- `three_d_creation`
- `flat_carton_design`
- `ean_sticker_creation`

## 2. Create a Picture Cleaning batch

Request:

`POST /workflow/batches/from-folder-manifest`

Example body:

```json
{
  "name": "May Sofa Work",
  "source_folder_name": "MAY_SOFA_IMAGES",
  "description": "",
  "brand": "By Boo",
  "task_type_key": "picture_cleaning",
  "assignment_mode": "manual",
  "assignee_ids": [],
  "file_manifest": [
    {
      "name": "1.jpg",
      "relative_path": "MAY_SOFA_IMAGES/1.jpg",
      "folder_path": "MAY_SOFA_IMAGES",
      "extension": "jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 123456
    },
    {
      "name": "2.png",
      "relative_path": "MAY_SOFA_IMAGES/2.png",
      "folder_path": "MAY_SOFA_IMAGES",
      "extension": "png",
      "mime_type": "image/png",
      "size_bytes": 123456
    },
    {
      "name": "notes.txt",
      "relative_path": "MAY_SOFA_IMAGES/notes.txt",
      "folder_path": "MAY_SOFA_IMAGES",
      "extension": "txt",
      "mime_type": "text/plain",
      "size_bytes": 100
    }
  ]
}
```

Expected:

- batch created successfully
- `counts.total_files = 3`
- `counts.image_files = 2`
- `counts.total_tasks = 2`
- tasks created:
  - `Picture Cleaning - 1.jpg`
  - `Picture Cleaning - 2.png`
- `notes.txt` does not create a task

## 3. Duplicate batch should fail

Send the same request again with:

- same `source_folder_name`
- same `task_type_key`

Expected:

- request is blocked
- response message indicates a duplicate active batch already exists

## 4. Create a 3D Creation batch

Request body example:

```json
{
  "name": "3D Chair Table Run",
  "source_folder_name": "MAIN_FOLDER",
  "brand": "By Boo",
  "task_type_key": "three_d_creation",
  "assignment_mode": "manual",
  "assignee_ids": [],
  "file_manifest": [
    {
      "name": "front.jpg",
      "relative_path": "MAIN_FOLDER/Chair 001/front.jpg",
      "folder_path": "MAIN_FOLDER/Chair 001",
      "extension": "jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 100
    },
    {
      "name": "side.jpg",
      "relative_path": "MAIN_FOLDER/Chair 001/side.jpg",
      "folder_path": "MAIN_FOLDER/Chair 001",
      "extension": "jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 100
    },
    {
      "name": "front.jpg",
      "relative_path": "MAIN_FOLDER/Table 002/front.jpg",
      "folder_path": "MAIN_FOLDER/Table 002",
      "extension": "jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 100
    }
  ]
}
```

Expected:

- 2 tasks are created
- task titles:
  - `3D Creation - Chair 001`
  - `3D Creation - Table 002`
- each task stores only the files from its own direct subfolder

## 5. Create a once-per-batch task type batch

Use:

- `pis_creation`
- or `flat_carton_design`

Expected:

- one task only
- title pattern:
  - `PIS Creation - <source_folder_name>`

## 6. Assignment on creation

Create a batch with valid `assignee_ids`.

Expected:

- generated tasks start in `assigned`
- `assigned_to` contains the selected users
- `TaskAssignment` records are created
- batch `counts.assigned_tasks` is populated

## 7. Task list and detail

Check:

- `GET /workflow/tasks`
- `GET /workflow/tasks/:id`
- `GET /workflow/batches`
- `GET /workflow/batches/:id`

Expected:

- manager/admin can see all
- non-privileged users only see tasks assigned to them
- task detail includes:
  - batch
  - task type
  - department
  - assignments
  - status history
  - comments

## 8. Start and submit task as assignee

Assignee calls:

- `PATCH /workflow/tasks/:id/start`
- `PATCH /workflow/tasks/:id/submit`

Expected:

- `assigned -> in_progress`
- `in_progress -> submitted`
- or `assigned -> submitted`
- status history rows are added
- batch counts update automatically

## 9. Approve / review / rework as manager

Manager/admin calls:

- `PATCH /workflow/tasks/:id/review`
- `PATCH /workflow/tasks/:id/approve`
- `PATCH /workflow/tasks/:id/rework`

Expected:

- `submitted -> review`
- `submitted -> completed`
- `review -> completed`
- `submitted -> rework`
- `review -> rework`
- rework requires a note/reason
- `rework_count` increments
- `reviewed_by`, `reviewed_at`, and `completed_at` are set where appropriate

## 10. Rework loop

After rework, assignee should be able to:

- `PATCH /workflow/tasks/:id/start`
- `PATCH /workflow/tasks/:id/submit`

Expected:

- `rework -> in_progress`
- `rework -> submitted`

## 11. Approver cannot approve their own assigned task

Assign a task to a manager/admin and then attempt:

- `PATCH /workflow/tasks/:id/approve`

Expected:

- request is rejected
- approver cannot approve a task assigned to themselves

## 12. Batch cancel

Manager/admin calls:

- `PATCH /workflow/batches/:id/cancel`

Expected:

- batch status becomes `cancelled`
- active task assignments become removed
- unfinished tasks become `cancelled`
- status history rows are created
- a new batch for the same folder + task type can be created afterward

## 13. Comment flow

Request:

`POST /workflow/tasks/:id/comments`

Example body:

```json
{
  "comment": "Please check the shadow around the chair leg.",
  "comment_type": "general"
}
```

Expected:

- comment saved
- comment appears in task detail

## 14. Security / validation checks

Confirm these failures:

- empty `file_manifest` is rejected
- manifest over the safe max is rejected
- inactive or unknown `task_type_key` is rejected
- invalid `assignee_ids` are rejected
- invalid batch/task/task-type/department ids are rejected
- manifest paths containing `..` are rejected
- absolute paths are rejected
- generic task status endpoint cannot set `assigned` directly

## 15. Storage check

Expected:

- no physical files are uploaded to Wasabi
- no manifest files are stored locally
- no output attachments are created
- only metadata from the manifest is saved in workflow task documents
