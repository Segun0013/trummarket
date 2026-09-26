import { describe, expect, it } from "vitest";
import { filterWalletRecords, groupRecordsByDay } from "./Home";

const records = [
  { id: 1, kind: "expense" as const, amountCents: 1200, category: "Food", description: "Market", occurredAt: new Date("2026-08-14T10:00:00Z") },
  { id: 2, kind: "expense" as const, amountCents: 900, category: "Transport", description: "Metro", occurredAt: new Date("2026-08-14T08:00:00Z") },
  { id: 3, kind: "income" as const, amountCents: 5000, category: "Salary", description: "August", occurredAt: new Date("2026-08-13T12:00:00Z") },
];

describe("Records view helpers", () => {
  it("combines a category selection with free-text search", () => {
    expect(filterWalletRecords(records, "market", "Food").map(record => record.id)).toEqual([1]);
    expect(filterWalletRecords(records, "metro", "Food")).toEqual([]);
  });

  it("groups filtered records by their UTC calendar day", () => {
    expect(groupRecordsByDay(filterWalletRecords(records, "", "")).map(group => ({ key: group.key, ids: group.records.map(record => record.id) }))).toEqual([
      { key: "2026-08-14", ids: [1, 2] },
      { key: "2026-08-13", ids: [3] },
    ]);
  });
});
