// Agent behavior configuration for the Vidura chat system.
//
// Behavior is derived from per-user settings (user_chat_settings) so the user
// can control the assistant's language, verbosity, persona, memory depth,
// retrieval breadth, and creativity from the Settings screen. This module
// resolves those settings into concrete model parameters and a system prompt;
// the transport/streaming lives in index.ts.

export type ChatSettings = {
  responseLanguage: "auto" | "si" | "en" | "singlish";
  answerStyle: "concise" | "balanced" | "detailed";
  customInstructions: string;
  memoryDepth: "short" | "medium" | "long";
  retrievalDepth: "focused" | "standard" | "broad";
  creativity: "focused" | "balanced" | "creative";
};

export const defaultChatSettings: ChatSettings = {
  responseLanguage: "auto",
  answerStyle: "balanced",
  customInstructions: "",
  memoryDepth: "medium",
  retrievalDepth: "standard",
  creativity: "balanced",
};

export type AgentName = "video" | "library";

export type ResolvedAgent = {
  temperature: number;
  maxHistoryMessages: number;
  maxMatchedSegments: number;
  instructions: string;
  titleInstructions: string;
};

const languageDirective: Record<ChatSettings["responseLanguage"], string> = {
  auto:
    "Detect the user's language and reply in it: English questions get English answers; Sinhala script gets Sinhala; Singlish (Sinhala written in Latin letters) gets simple Singlish or Sinhala.",
  si:
    "ALWAYS reply in Sinhala using proper Sinhala Unicode script (සිංහල), regardless of the language the user writes in. Keep unavoidable technical terms in English where no common Sinhala word exists.",
  en:
    "ALWAYS reply in clear English, regardless of the language the user writes in.",
  singlish:
    "ALWAYS reply in Singlish (Sinhala written in Latin/English letters), regardless of the language the user writes in. Keep it casual and easy to read.",
};

const styleDirective: Record<ChatSettings["answerStyle"], string> = {
  concise: "Be brief: 1-3 sentences or a short bullet list. No preamble.",
  balanced: "Keep answers concise and conversational.",
  detailed:
    "Give thorough, well-explained answers with examples from the video where helpful.",
};

const memoryToHistory: Record<ChatSettings["memoryDepth"], number> = {
  short: 4,
  medium: 12,
  long: 24,
};

const retrievalToSegments: Record<ChatSettings["retrievalDepth"], number> = {
  focused: 20,
  standard: 60,
  broad: 120,
};

const creativityToTemperature: Record<ChatSettings["creativity"], number> = {
  focused: 0.1,
  balanced: 0.35,
  creative: 0.7,
};

function baseBehavior(settings: ChatSettings) {
  return [
    "You are Vidura, a friendly study assistant for a personal library of YouTube videos with Sinhala subtitles.",
    "Answer ONLY from the provided context (transcripts, notes, video catalog). If the answer is not in the context, say so honestly.",
    languageDirective[settings.responseLanguage],
    "Always cite where in the video your answer comes from using [mm:ss] timestamps taken from the context.",
    "Format answers with simple Markdown: short paragraphs, **bold** for key terms, and '-' bullet lists. No headings or tables.",
    styleDirective[settings.answerStyle],
  ];
}

const agentExtras: Record<AgentName, { instruction: string; title: string }> = {
  video: {
    instruction:
      "You are focused on ONE video. The full transcript and the user's timestamped notes are provided.",
    title:
      "Name this chat about a single video. 3-6 words, same language as the conversation, plain text only, no quotes.",
  },
  library: {
    instruction:
      "You can see the user's whole video library. When you reference a video, name it and give the timestamp like: \"Video Title\" [mm:ss].",
    title:
      "Name this library chat session. 3-6 words, same language as the conversation, plain text only, no quotes.",
  },
};

export function resolveAgent(
  agentName: AgentName,
  settings: ChatSettings,
): ResolvedAgent {
  const lines = baseBehavior(settings);
  lines.push(agentExtras[agentName].instruction);

  const custom = settings.customInstructions.trim();
  if (custom) {
    lines.push(
      `Additional user instructions (follow unless they conflict with staying grounded in the context): ${
        custom.slice(0, 800)
      }`,
    );
  }

  return {
    temperature: creativityToTemperature[settings.creativity],
    maxHistoryMessages: memoryToHistory[settings.memoryDepth],
    maxMatchedSegments: retrievalToSegments[settings.retrievalDepth],
    instructions: lines.join("\n"),
    titleInstructions: agentExtras[agentName].title,
  };
}
