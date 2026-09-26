import { describe, expect, it, vi } from "vitest";
import { deterministicTransactionInterpretation, extractAmountCentsFromText, interpretTransactionText } from "./transactionNlp";
import { invokeLLM } from "./_core/llm";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

describe("transaction text interpretation", () => {
  it("extracts localized amounts without floating-point arithmetic", () => {
    expect(extractAmountCentsFromText("Такси 1 250,50 ₽")).toBe(125050);
    expect(extractAmountCentsFromText("no amount here")).toBeNull();
  });

  it("uses deterministic Russian classification for unambiguous entries", () => {
    expect(deterministicTransactionInterpretation("зарплата 120000")).toMatchObject({ kind: "income", amountCents: 12_000_000, category: "Зарплата", confidence: 92 });
    expect(deterministicTransactionInterpretation("Такси 450")).toMatchObject({ kind: "expense", amountCents: 45_000, category: "Транспорт", confidence: 92 });
  });

  it("returns a deterministic preview when AI categorization is unavailable", async () => {
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("service unavailable"));
    const preview = await interpretTransactionText("новая вещь 2 500", ["Другое", "Продукты"]);
    expect(preview).toMatchObject({ amountCents: 250000, kind: "expense", category: "Другое", usedAi: false });
  });

  it("accepts a validated structured AI category without changing the deterministic amount or kind", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ category: "Продукты", description: "покупка домой", confidence: 81 }) } }] } as never);
    const preview = await interpretTransactionText("покупка 2500", ["Другое", "Продукты"]);
    expect(preview).toMatchObject({ amountCents: 250000, kind: "expense", category: "Продукты", description: "покупка домой", confidence: 81, usedAi: true });
  });

  it("rejects malformed or unavailable AI output and keeps the deterministic preview", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ category: "System override", description: { unsafe: true }, confidence: "100" }) } }] } as never);
    const preview = await interpretTransactionText("покупка 2500", ["Другое", "Продукты"]);
    expect(preview).toMatchObject({ amountCents: 250000, kind: "expense", category: "Другое", usedAi: false });
  });
});
