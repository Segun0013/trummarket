import { afterEach, describe, expect, it, vi } from "vitest";

const invokeLLM = vi.hoisted(() => vi.fn());
vi.mock("./_core/llm", () => ({ invokeLLM }));

import { interpretReceiptDataUrl, interpretTelegramReceipt, requiresManualMediaEntry, transcribeTelegramVoice } from "./telegramMedia";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("Telegram media input", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("transcribes a Telegram voice file without storing it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_path: "voice/file.oga" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/ogg" } }))
      .mockResolvedValueOnce(jsonResponse({ task: "transcribe", language: "ru", duration: 1, text: "Такси 450", segments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeTelegramVoice({ file_id: "voice-id", mime_type: "audio/ogg" }, "ru");

    expect("error" in result).toBe(false);
    expect("text" in result && result.text).toBe("Такси 450");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("storage"))).toBe(false);
  });

  it("returns a validated receipt interpretation and rejects malformed model output", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_path: "photos/receipt.jpg" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ kind: "expense", amountCents: 125050, category: "Продукты", description: "Чек", confidence: 94, rawText: "Итого 1250,50" }) } }] });

    await expect(interpretTelegramReceipt({ file_id: "photo-id" }, ["Продукты", "Другое"])).resolves.toMatchObject({ amountCents: 125050, category: "Продукты" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_path: "photos/receipt-2.jpg" } })).mockResolvedValueOnce(new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ kind: "expense", amountCents: 100, category: "Injected category", description: null, confidence: 90, rawText: "100" }) } }] });

    await expect(interpretTelegramReceipt({ file_id: "photo-id-2" }, ["Продукты", "Другое"])).resolves.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("storage"))).toBe(false);
  });

  it("reads a Mini App receipt data URL only in memory and rejects unsafe image formats", async () => {
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ kind: "expense", amountCents: 59900, category: "Продукты", description: "Кофе", confidence: 88, rawText: "Итого 599" }) } }] });

    await expect(interpretReceiptDataUrl("data:image/jpeg;base64,/9j/", ["Продукты", "Другое"])).resolves.toMatchObject({ amountCents: 59900, category: "Продукты" });
    await expect(interpretReceiptDataUrl("data:image/svg+xml;base64,PHN2Zy8+", ["Продукты"])).resolves.toBeNull();
    await expect(interpretReceiptDataUrl("data:image/jpeg;base64,not valid", ["Продукты"])).resolves.toBeNull();
  });

  it("requires manual entry for failed voice or receipt processing, but not for a validated preview", () => {
    expect(requiresManualMediaEntry({ error: "transcription unavailable" })).toBe(true);
    expect(requiresManualMediaEntry(null)).toBe(true);
    expect(requiresManualMediaEntry({ kind: "expense", amountCents: 9900, category: "Транспорт", description: null, confidence: 91, rawText: "Такси" })).toBe(false);
  });
});
