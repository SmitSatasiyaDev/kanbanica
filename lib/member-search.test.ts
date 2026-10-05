import { describe, expect, it } from "vitest";
import { filterMembersByQuery } from "@/lib/member-search";

const members = [
  { userId: "1", name: "Jayesh Dholakiya", email: "j@x.com" },
  { userId: "2", name: "Smit", email: "s@x.com" },
  { userId: "3", name: "", email: "dsdsds@x.com" },
];

describe("filterMembersByQuery", () => {
  it("returns every member for an empty or whitespace query", () => {
    expect(filterMembersByQuery(members, "")).toHaveLength(3);
    expect(filterMembersByQuery(members, "   ")).toHaveLength(3);
  });

  it("matches partial names case-insensitively", () => {
    expect(filterMembersByQuery(members, "smi").map((m) => m.userId)).toEqual([
      "2",
    ]);
    expect(filterMembersByQuery(members, "JAY").map((m) => m.userId)).toEqual([
      "1",
    ]);
  });

  it("trims leading/trailing spaces", () => {
    expect(
      filterMembersByQuery(members, "  smit ").map((m) => m.userId)
    ).toEqual(["2"]);
  });

  it("falls back to email when a member has no name", () => {
    expect(filterMembersByQuery(members, "dsds").map((m) => m.userId)).toEqual([
      "3",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterMembersByQuery(members, "zzz")).toEqual([]);
  });
});
