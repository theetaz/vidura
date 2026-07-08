import { Hono } from "hono";
import { sql } from "../db.ts";
import { type AppEnv, requireUser } from "../middleware/auth.ts";
import { fetchChatSettings } from "../lib/chat.ts";
import type { ChatSettings } from "../lib/agents.ts";
import {
  fetchTranslationSettings,
  saveTranslationSettings,
  type TranslationSettings,
} from "../lib/translation-settings.ts";

export const settings = new Hono<AppEnv>();
settings.use("*", requireUser);

// GET /api/settings/translation
settings.get("/translation", async (c) => {
  return c.json(await fetchTranslationSettings(c.get("user").id));
});

// PUT /api/settings/translation
settings.put("/translation", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as
    | Partial<TranslationSettings>
    | null;
  if (!body) return c.json({ error: "Invalid body" }, 400);

  const current = await fetchTranslationSettings(ownerId);
  const saved = await saveTranslationSettings(ownerId, {
    targetLanguage: body.targetLanguage ?? current.targetLanguage,
    systemPrompt: body.systemPrompt ?? current.systemPrompt,
  });
  return c.json(saved);
});

// GET /api/settings/chat
settings.get("/chat", async (c) => {
  return c.json(await fetchChatSettings(c.get("user").id));
});

// PUT /api/settings/chat
settings.put("/chat", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as Partial<ChatSettings> | null;
  if (!body) return c.json({ error: "Invalid body" }, 400);

  const current = await fetchChatSettings(ownerId);
  const next: ChatSettings = { ...current, ...body };

  await sql`
    insert into user_chat_settings (owner_id, response_language, answer_style,
      custom_instructions, memory_depth, retrieval_depth, creativity)
    values (${ownerId}, ${next.responseLanguage}, ${next.answerStyle},
      ${next.customInstructions.slice(0, 800)}, ${next.memoryDepth},
      ${next.retrievalDepth}, ${next.creativity})
    on conflict (owner_id) do update set
      response_language = excluded.response_language,
      answer_style = excluded.answer_style,
      custom_instructions = excluded.custom_instructions,
      memory_depth = excluded.memory_depth,
      retrieval_depth = excluded.retrieval_depth,
      creativity = excluded.creativity
  `;

  return c.json(next);
});
