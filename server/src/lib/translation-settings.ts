import { sql } from "../db.ts";

export type TranslationSettings = {
  // Human-readable target language (e.g. "Sinhala", "Italian"). Used both as
  // the videos.target_language / translated_segments.language_code key and in
  // the translation prompt.
  targetLanguage: string;
  // Optional custom "guidance" portion of the system prompt. Empty = built-in.
  systemPrompt: string;
};

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  targetLanguage: "Sinhala",
  systemPrompt: "",
};

export async function fetchTranslationSettings(
  ownerId: string,
): Promise<TranslationSettings> {
  const [row] = await sql<
    Array<{ target_language: string; system_prompt: string }>
  >`
    select target_language, system_prompt
    from user_translation_settings where owner_id = ${ownerId}
  `;
  if (!row) return DEFAULT_TRANSLATION_SETTINGS;
  return {
    targetLanguage: row.target_language?.trim() ||
      DEFAULT_TRANSLATION_SETTINGS.targetLanguage,
    systemPrompt: row.system_prompt ?? "",
  };
}

export async function saveTranslationSettings(
  ownerId: string,
  next: TranslationSettings,
): Promise<TranslationSettings> {
  const targetLanguage = next.targetLanguage.trim().slice(0, 60) ||
    DEFAULT_TRANSLATION_SETTINGS.targetLanguage;
  const systemPrompt = next.systemPrompt.slice(0, 4000);
  await sql`
    insert into user_translation_settings (owner_id, target_language, system_prompt)
    values (${ownerId}, ${targetLanguage}, ${systemPrompt})
    on conflict (owner_id) do update set
      target_language = excluded.target_language,
      system_prompt = excluded.system_prompt,
      updated_at = now()
  `;
  return { targetLanguage, systemPrompt };
}
