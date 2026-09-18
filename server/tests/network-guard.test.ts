import { expect, it } from "vitest";

it.each(["https://openrouter.ai/api/v1/chat/completions", new Request("https://openrouter.ai/api/v1/chat/completions")])("blocks unstubbed external fetch for strings and Requests", async (input) => {
  await expect(fetch(input)).rejects.toThrow("External fetch blocked in tests");
});
