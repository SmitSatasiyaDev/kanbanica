import { describe, expect, it } from "vitest";
import type { CustomFieldRow } from "@/app/actions/custom-field";
import { IGNORE_TARGET } from "@/lib/import-export/column-mapping";
import {
  detectDuplicateRowIndexes,
  findUnmappedRequiredFields,
  findUnmappedRequiredFixedFields,
  type MappedTaskData,
  type ValidationContext,
  validateImportRow,
} from "@/lib/import-export/validate-row";

function baseContext(
  overrides: Partial<ValidationContext> = {}
): ValidationContext {
  return {
    workspaceId: "ws-1",
    listStatuses: [
      { id: "status-open", name: "Open", type: "OPEN" },
      { id: "status-done", name: "Done", type: "CLOSED" },
    ],
    membersByEmail: new Map([
      [
        "jane@example.com",
        { userId: "user-jane", name: "Jane Doe", email: "jane@example.com" },
      ],
    ]),
    tagNamesLower: new Set(["bug"]),
    customFields: [],
    existingTasksByRef: new Map(),
    fileRowTitleToIndex: new Map(),
    ...overrides,
  };
}

function customField(overrides: Partial<CustomFieldRow>): CustomFieldRow {
  return {
    id: "field-1",
    workspaceId: "ws-1",
    spaceId: null,
    listId: null,
    name: "Field",
    slug: "field",
    description: null,
    placeholder: null,
    type: "TEXT",
    config: {},
    defaultValue: null,
    required: false,
    isArchived: false,
    archivedAt: null,
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomFieldRow;
}

describe("validateImportRow", () => {
  it("skips a fully empty row without counting it as invalid", async () => {
    const result = await validateImportRow(
      { Title: "", Status: "" },
      { Title: "title", Status: "status" },
      baseContext(),
      1
    );
    expect(result.status).toBe("skipped");
    expect(result.data).toBeNull();
  });

  it("requires a title", async () => {
    const result = await validateImportRow(
      { Title: "", Status: "Open" },
      { Title: "title", Status: "status" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("Title is required");
  });

  it("produces a valid row when every mapped field is correct", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Status: "Open", Priority: "HIGH" },
      { Title: "title", Status: "status", Priority: "priority" },
      baseContext(),
      1
    );
    expect(result.status).toBe("valid");
    expect(result.data).toMatchObject({
      title: "Fix bug",
      statusId: "status-open",
      priority: "HIGH",
    });
  });

  it("errors on an unknown status name and lists the valid ones", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Status: "Nonexistent" },
      { Title: "title", Status: "status" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toContain('Status "Nonexistent" was not found');
    expect(result.errors[0]).toContain("Open");
  });

  it("defaults to the list's first OPEN status with a warning when status is blank", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Status: "" },
      { Title: "title", Status: "status" },
      baseContext(),
      1
    );
    expect(result.status).toBe("warning");
    expect(result.data?.statusId).toBe("status-open");
    expect(result.warnings[0]).toContain('defaulting to "Open"');
  });

  it("errors on an invalid priority value", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Priority: "SUPER_URGENT" },
      { Title: "title", Priority: "priority" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toContain('Priority "SUPER_URGENT" is invalid');
  });

  it("defaults priority to NONE when blank", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug" },
      { Title: "title" },
      baseContext(),
      1
    );
    expect(result.data?.priority).toBe("NONE");
  });

  it("errors on an invalid due date", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", "Due Date": "not-a-date" },
      { Title: "title", "Due Date": "dueDateEnd" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toContain("not a valid date");
  });

  it("keeps a YYYY-MM-DD due date as the same calendar day (no timezone shift)", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Start: "2030-01-01", Due: "2030-01-31" },
      { Title: "title", Start: "dueDateStart", Due: "dueDateEnd" },
      baseContext(),
      1
    );
    expect(result.data?.dueDateStart).toBe("2030-01-01");
    expect(result.data?.dueDateEnd).toBe("2030-01-31");
  });

  it("takes the date part of a full ISO timestamp (older exports)", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Due: "2030-01-31T00:00:00.000Z" },
      { Title: "title", Due: "dueDateEnd" },
      baseContext(),
      1
    );
    expect(result.data?.dueDateEnd).toBe("2030-01-31");
  });

  it("rejects impossible calendar days and non-ISO formats", async () => {
    for (const bad of ["2030-02-30", "01/31/2030", "Jan 31 2030"]) {
      const result = await validateImportRow(
        { Title: "Fix bug", Due: bad },
        { Title: "title", Due: "dueDateEnd" },
        baseContext(),
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors[0]).toContain("YYYY-MM-DD");
    }
  });

  it("warns when the due date is before the start date", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Start: "2026-02-10", Due: "2026-02-01" },
      { Title: "title", Start: "dueDateStart", Due: "dueDateEnd" },
      baseContext(),
      1
    );
    expect(result.status).toBe("warning");
    expect(result.warnings).toContain("Due date is before the start date");
  });

  it("resolves an assignee by email", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Assignee: "jane@example.com" },
      { Title: "title", Assignee: "assignees" },
      baseContext(),
      1
    );
    expect(result.data?.assigneeIds).toEqual(["user-jane"]);
  });

  it('errors with "Assignee \\"X\\" was not found" for an unknown assignee', async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Assignee: "John Doe" },
      { Title: "title", Assignee: "assignees" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain('Assignee "John Doe" was not found');
  });

  it("warns (not errors) when a tag doesn't exist yet — it will be created", async () => {
    const result = await validateImportRow(
      { Title: "Fix bug", Status: "Open", Tags: "bug, new-tag" },
      { Title: "title", Status: "status", Tags: "tags" },
      baseContext(),
      1
    );
    expect(result.status).toBe("warning");
    expect(result.data?.tagNames).toEqual(["bug", "new-tag"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("new-tag");
    expect(result.warnings[0]).not.toContain("bug,");
  });

  it("resolves an existing parent task by title", async () => {
    const context = baseContext({
      existingTasksByRef: new Map([
        ["parent task", { taskId: "task-parent", hasParent: false }],
      ]),
    });
    const result = await validateImportRow(
      { Title: "Child", Parent: "Parent Task" },
      { Title: "title", Parent: "parentTask" },
      context,
      1
    );
    expect(result.data?.parentRef).toEqual({
      type: "existing",
      taskId: "task-parent",
    });
  });

  it("resolves a parent referencing another row in the same file", async () => {
    const context = baseContext({
      fileRowTitleToIndex: new Map([["parent row", 1]]),
    });
    const result = await validateImportRow(
      { Title: "Child", Parent: "Parent Row" },
      { Title: "title", Parent: "parentTask" },
      context,
      2
    );
    expect(result.data?.parentRef).toEqual({ type: "inFile", rowIndex: 1 });
  });

  it("rejects nesting a subtask under an existing subtask (one level only)", async () => {
    const context = baseContext({
      existingTasksByRef: new Map([
        ["parent task", { taskId: "task-parent", hasParent: true }],
      ]),
    });
    const result = await validateImportRow(
      { Title: "Child", Parent: "Parent Task" },
      { Title: "title", Parent: "parentTask" },
      context,
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toContain(
      "Cannot nest subtasks more than one level"
    );
  });

  it('errors with "Parent task \\"X\\" was not found" when the parent can\'t be resolved', async () => {
    const result = await validateImportRow(
      { Title: "Child", Parent: "Nowhere" },
      { Title: "title", Parent: "parentTask" },
      baseContext(),
      1
    );
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain('Parent task "Nowhere" was not found');
  });

  describe("custom fields", () => {
    it("validates a TEXT field", async () => {
      const field = customField({ id: "f-text", type: "TEXT" });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", Notes: "hello" },
        { Title: "title", Notes: "customField:f-text" },
        context,
        1
      );
      expect(result.data?.customFieldValues["f-text"]).toBe("hello");
    });

    it("validates a NUMBER field and respects min/max", async () => {
      const field = customField({
        id: "f-num",
        type: "NUMBER",
        config: { min: 0, max: 10 },
      });
      const context = baseContext({ customFields: [field] });
      const tooHigh = await validateImportRow(
        { Title: "Fix bug", Score: "20" },
        { Title: "title", Score: "customField:f-num" },
        context,
        1
      );
      expect(tooHigh.status).toBe("invalid");
      expect(tooHigh.errors[0]).toContain("at most 10");

      const ok = await validateImportRow(
        { Title: "Fix bug", Score: "5" },
        { Title: "title", Score: "customField:f-num" },
        context,
        2
      );
      expect(ok.data?.customFieldValues["f-num"]).toBe(5);
    });

    it("parses common checkbox spellings", async () => {
      const field = customField({ id: "f-check", type: "CHECKBOX" });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", Billable: "yes" },
        { Title: "title", Billable: "customField:f-check" },
        context,
        1
      );
      expect(result.data?.customFieldValues["f-check"]).toBe(true);
    });

    it("errors on an unparseable checkbox value", async () => {
      const field = customField({ id: "f-check", type: "CHECKBOX" });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", Billable: "maybe" },
        { Title: "title", Billable: "customField:f-check" },
        context,
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors[0]).toContain("must be true/false");
    });

    it("maps a SINGLE_SELECT label to its option id", async () => {
      const field = customField({
        id: "f-select",
        type: "SINGLE_SELECT",
        config: { options: [{ id: "opt-1", label: "Enterprise" }] },
      });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", "Customer Type": "Enterprise" },
        { Title: "title", "Customer Type": "customField:f-select" },
        context,
        1
      );
      expect(result.data?.customFieldValues["f-select"]).toBe("opt-1");
    });

    it("errors on an unknown SINGLE_SELECT label", async () => {
      const field = customField({
        id: "f-select",
        type: "SINGLE_SELECT",
        config: { options: [{ id: "opt-1", label: "Enterprise" }] },
      });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", "Customer Type": "SMB" },
        { Title: "title", "Customer Type": "customField:f-select" },
        context,
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors[0]).toContain("not a valid option");
    });

    it("resolves a PERSON field by email without a hard DB dependency", async () => {
      const field = customField({ id: "f-person", type: "PERSON" });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", Reviewer: "jane@example.com" },
        { Title: "title", Reviewer: "customField:f-person" },
        context,
        1
      );
      expect(result.data?.customFieldValues["f-person"]).toBe("user-jane");
    });

    it("errors when a required custom field is mapped but empty on this row", async () => {
      const field = customField({ id: "f-req", type: "TEXT", required: true });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug", Notes: "" },
        { Title: "title", Notes: "customField:f-req" },
        context,
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors).toContain("Field is required");
    });

    it("errors when a required custom field isn't mapped to any column at all", async () => {
      const field = customField({ id: "f-req", type: "TEXT", required: true });
      const context = baseContext({ customFields: [field] });
      const result = await validateImportRow(
        { Title: "Fix bug" },
        { Title: "title" },
        context,
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors[0]).toContain("is not mapped to a column");
    });
  });

  describe('columns mapped to "Do not import"', () => {
    it("ignores a Status column mapped to Do not import — no validation, no warning, silently defaults", async () => {
      const result = await validateImportRow(
        { Title: "Fix bug", Status: "Open" },
        { Title: "title", Status: IGNORE_TARGET },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data?.statusId).toBe("status-open");
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("ignores a Priority column mapped to Do not import, even with an invalid raw value", async () => {
      const result = await validateImportRow(
        { Title: "Fix bug", Priority: "SUPER_URGENT" },
        { Title: "title", Priority: IGNORE_TARGET },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data?.priority).toBe("NONE");
      expect(result.errors).toEqual([]);
    });

    it("ignores an Assignee column mapped to Do not import — an unknown name causes no error", async () => {
      const result = await validateImportRow(
        { Title: "Fix bug", Assignee: "Nobody Real" },
        { Title: "title", Assignee: IGNORE_TARGET },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data?.assigneeIds).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("ignores a Tags column mapped to Do not import — nothing is created or imported", async () => {
      const result = await validateImportRow(
        { Title: "Fix bug", Tags: "bug, brand-new-tag" },
        { Title: "title", Tags: IGNORE_TARGET },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data?.tagNames).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("ignores a Description column mapped to Do not import — description stays empty", async () => {
      const result = await validateImportRow(
        { Title: "Fix bug", Description: "Some notes" },
        { Title: "title", Description: IGNORE_TARGET },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data?.description).toBeNull();
    });

    it("still validates/imports normally for fields that ARE mapped, alongside ignored ones", async () => {
      const result = await validateImportRow(
        {
          Title: "Fix bug",
          Status: "Open",
          Priority: "HIGH",
          Assignee: "jane@example.com",
          Tags: "bug",
          Notes: "ignored text",
        },
        {
          Title: "title",
          Status: "status",
          Priority: "priority",
          Assignee: "assignees",
          Tags: "tags",
          Notes: IGNORE_TARGET,
        },
        baseContext(),
        1
      );
      expect(result.status).toBe("valid");
      expect(result.data).toMatchObject({
        title: "Fix bug",
        statusId: "status-open",
        priority: "HIGH",
        assigneeIds: ["user-jane"],
        tagNames: ["bug"],
        description: null,
      });
    });

    it("still requires Title even when optional columns are ignored", async () => {
      // Priority stays mapped (and non-blank) so the row isn't treated as
      // fully empty — isolating the Title check from the separate
      // blank-row-skip behavior.
      const result = await validateImportRow(
        { Title: "", Status: "Open", Priority: "HIGH" },
        { Title: "title", Status: IGNORE_TARGET, Priority: "priority" },
        baseContext(),
        1
      );
      expect(result.status).toBe("invalid");
      expect(result.errors).toContain("Title is required");
      expect(result.data?.statusId).toBe("status-open");
    });
  });
});

describe("findUnmappedRequiredFixedFields", () => {
  it("flags Title when it isn't mapped", () => {
    expect(
      findUnmappedRequiredFixedFields({ Description: "description" })
    ).toEqual(["Title"]);
  });

  it("returns nothing once Title is mapped", () => {
    expect(findUnmappedRequiredFixedFields({ Name: "title" })).toEqual([]);
  });
});

describe("findUnmappedRequiredFields", () => {
  it("lists required custom fields with no column mapped to them", () => {
    const fields = [{ id: "f1", name: "Customer Type", required: true }];
    expect(findUnmappedRequiredFields({ Title: "title" }, fields)).toEqual([
      "Customer Type",
    ]);
    expect(
      findUnmappedRequiredFields(
        { Title: "title", CT: "customField:f1" },
        fields
      )
    ).toEqual([]);
  });
});

describe("detectDuplicateRowIndexes", () => {
  function row(
    rowIndex: number,
    data: Partial<MappedTaskData>
  ): {
    rowIndex: number;
    data: MappedTaskData;
  } {
    return {
      rowIndex,
      data: {
        title: "Fix bug",
        description: null,
        statusId: "status-open",
        priority: "NONE",
        assigneeIds: [],
        dueDateStart: null,
        dueDateEnd: null,
        tagNames: [],
        parentRef: null,
        customFieldValues: {},
        ...data,
      },
    };
  }

  it("flags two rows with the same title/status/assignees/due date", () => {
    const duplicates = detectDuplicateRowIndexes([row(1, {}), row(2, {})]);
    expect(duplicates).toEqual(new Set([1, 2]));
  });

  it("does not flag rows that differ", () => {
    const duplicates = detectDuplicateRowIndexes([
      row(1, { title: "Fix bug" }),
      row(2, { title: "Write docs" }),
    ]);
    expect(duplicates.size).toBe(0);
  });
});
