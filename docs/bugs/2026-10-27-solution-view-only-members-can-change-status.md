# Solution: changing status requires Edit

**Server (`updateTaskStatus`, `app/actions/task.ts`)**

- Requires **Edit** (`requireEditAccess`) on the task's real space (derived from
  the task row, see the `task-actions-trust-caller-space` solution).
- Validates the target status: it must exist and its list must be in the **same
  space** as the task (`listStatus` joined to `list` where `list.space_id` is the
  task's space). The task's own list is not required, because the Sprint board
  assigns statuses across the lists of a project. Otherwise "Status not found".
- Updates with `RETURNING`; activity log and watcher notifications are written
  only when a row was updated and the status actually changed.

**UI (disabled/non-interactive when `canEdit` is false)**

- `components/task/task-detail-panel.tsx`: status `Select` gets
  `disabled={!canEdit}` (it was not gated at all).
- `task-detail-page.tsx`: both status pickers (mobile and desktop) use
  `PopoverTrigger disabled={!canEditNow}`.
- `components/task/task-list-row.tsx`: the hover "Move Status" popover renders
  only for `canEdit`.
- Board (`board-view.tsx`): cards are not draggable without `canEdit`
  (`useSortable({ disabled })`), `onDragEnd` returns early, and the card's
  subtask complete toggle is disabled. The card's quick "Complete" button was
  already gated.
- List (`list-view.tsx`): rows are not draggable without `canEdit`;
  `onDragEnd` returns early.
- Sprint (`components/sprint/sprint-list-view.tsx`): list rows and board cards
  are not draggable without `canEdit` (`canEdit` threaded to
  `SprintBoardColumn` / `SprintBoardCard`); `onDragEnd` returns early.
- `subtask-row.tsx` already disabled its status trigger with `canEdit`; no
  change.

**Tests:** `app/actions/task-scope.test.ts` (view-only refused; status from
another space refused; status from another list of the same space accepted;
listless task; stale `listId`; no log when nothing changed).
