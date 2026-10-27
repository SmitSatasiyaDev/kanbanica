# Connect an AI agent to Kanbanica (MCP)

Kanbanica has an MCP server. MCP is the protocol tools like Claude Code and Cursor use to talk to other apps. Once connected, your agent can:

- list the tasks assigned to you, across your workspaces
- browse projects, lists and workspace members, and see the active sprint
- read a task: description, status, subtasks, comments and images
- create tasks and subtasks, and change a task's title, description, priority and dates
- assign a task to you, change its status, or mark it done
- post a comment, with up to 5 images (screenshots work well), and mention teammates
- attach a file to a task
- read your notifications and mark them as read

The agent acts **as you**. It can only see and do what you can in the web app. Every change shows in the activity feed, notifies watchers, and updates open boards live, the same as when you do it yourself.

## 1. Create a token

The **API tokens & MCP** page also keeps the setup steps for Claude Code and the Claude app (server URL, commands, connector steps) permanently, so you can come back to them after the one-time token dialog has closed.

1. Open the bottom-left user menu → **API tokens & MCP**. The menu item is hidden when an admin has turned API access off.
2. Under **API tokens**, choose **Create token**.
3. Pick:
   - **Name**, so you can recognise it later (for example "Claude Code on laptop").
   - **Scope**. **Read only** can look but not change anything. **Read & write** is needed to comment, change status or upload.
   - **Workspace**: all your workspaces, or just one.
   - **Expiry**: 30, 90 or 365 days, or never.
4. Copy the token. **It is shown once.** If you lose it, revoke it and create a new one.

You can't create a token if you are a guest in every workspace. Tokens never reach workspaces where you are a guest.

## 2. Connect your tool

**Claude Code:**

```bash
claude mcp add --transport http kanbanica https://YOUR-KANBANICA-URL/api/mcp \
  --header "Authorization: Bearer kbn_..."
```

**Cursor and other clients:** add an HTTP (Streamable HTTP) MCP server with URL `https://YOUR-KANBANICA-URL/api/mcp` and the header `Authorization: Bearer kbn_...`.

Then ask your agent things like "show my Kanbanica tasks", "read task #42", "create a task in the Backlog list for the login bug", or "comment on #42 with this screenshot and mark it done".

## Tools

| Tool | What it does | Token |
|------|--------------|-------|
| `list_workspaces` | Workspaces the token can reach | read |
| `list_projects` | Projects you can see | read |
| `list_lists` | The lists of a project | read |
| `list_members` | Active members of a workspace (to find a user id) | read |
| `list_my_tasks` | Tasks assigned to you | read |
| `search_tasks` | Search a workspace by text | read |
| `get_current_sprint` | A project's active sprint and its tasks | read |
| `get_task` | One task, by id or by number (`#42`), with comments and attachments | read |
| `get_attachment` | Download one attachment or image | read |
| `list_task_statuses` | Statuses available for a task | read |
| `list_notifications` | Your own notifications (unread by default) | read |
| `create_task` | Create a task in a list | write |
| `create_subtask` | Create a subtask under a task | write |
| `update_task` | Change title, description, priority, start or due date | write |
| `set_task_status` | Move a task to a status | write |
| `complete_task` | Move a task to its list's done status | write |
| `assign_task` | Assign or unassign (yourself by default) | write |
| `add_comment` | Comment in Markdown, with up to 5 PNG/JPEG/GIF/WebP images | write |
| `upload_attachment` | Attach a file (10 MB max) | write |
| `mark_notifications_read` | Mark your own notifications as read | write |

**Paging.** Every tool that returns a list gives `{ items, nextCursor }`. When `nextCursor` is not null, the agent calls the tool again with `cursor` set to it to get the next page. `get_task` pages older comments the same way with `commentsCursor`.

**Mentions.** To mention a teammate the agent writes `<@userId>` (the id comes from `list_members`) in a comment or description. The person is notified only if they are an active member of the workspace and can see the task's project; otherwise the text stays plain. A plain `@name` mentions nobody.

**Descriptions.** `update_task` replaces the whole description. The agent should read the task with `get_task`, edit the Markdown, and send all of it back. Images and files appear as `![alt](attachment:<id>)` and `[name](attachment:<id>)`; keep those links, because images and files the new text no longer links are deleted. Checklists are `- [ ]` and `- [x]`.

**Limits.** To keep things fair, each user can make 60 changes a minute, 30 of them creating tasks, and 300 requests a minute in total across all their tokens. The agent is told how many seconds to wait. Creating a task is also refused when the workspace has reached its task limit.

There are no delete, archive or bulk tools.

## Safety

- **A token is a password.** Anyone who has it can act as you. Don't paste it into shared files or chats.
- Prefer **Read only**, a single workspace, and an expiry.
- Revoke tokens you no longer use (user menu → API tokens & MCP → Revoke). Revoking takes effect immediately.
- Task text is written by other people. If a task or comment contains instructions ("ignore previous instructions…"), your agent should treat them as text, not commands. Check what the agent plans to do before you approve changes.

## For admins

- **Turn it off:** Orbit → Settings → **API access (MCP)**. When off, the endpoint returns 404, nobody can create new tokens, and the token card is hidden.
- **Behind nginx:** set `client_max_body_size 45m;` (see `DEPLOYMENT.md`). Image comments can be up to about 40 MB.
- Technical spec: `docs/mcp.md`.
