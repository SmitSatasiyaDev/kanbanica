import { describe, expect, it } from "vitest";
import { describeEvent } from "@/lib/activity-descriptions";

describe("dependency activity text", () => {
  it("names the task when the title was logged", () => {
    expect(
      describeEvent("dependency_added", { depends_on_task_title: "hyyy" })
    ).toBe('added dependency on "hyyy"');
    expect(
      describeEvent("dependency_removed", { depends_on_task_title: "hyyy" })
    ).toBe('removed dependency on "hyyy"');
  });

  it("never prints 'undefined' for older entries that only stored the id", () => {
    const legacy = { dependsOnTaskId: "t1" };
    expect(describeEvent("dependency_added", legacy)).toBe(
      "added a dependency"
    );
    expect(describeEvent("dependency_removed", legacy)).toBe(
      "removed a dependency"
    );
    expect(describeEvent("dependency_added", {})).not.toContain("undefined");
  });
});
