// Agent behavior configuration for the Vidura chat system.
//
// Each agent defines how the assistant behaves for one chat surface: its
// model settings, how much history it keeps, its personality/instruction
// prompt, and how session titles are generated. Adjust behavior here without
// touching the transport/streaming code in index.ts.

export type AgentConfig = {
  /** Env var that overrides the model for this agent; falls back to OPENROUTER_MODEL. */
  modelEnvVar: string;
  temperature: number;
  /** How many prior messages are replayed for conversational continuity. */
  maxHistoryMessages: number;
  /** Core behavior instructions shared with every request for this agent. */
  instructions: string;
  /** Prompt used to auto-name a chat session after the first exchange. */
  titleInstructions: string;
};

const sharedBehavior = [
  "You are Vidura, a friendly study assistant for a personal library of YouTube videos with Sinhala subtitles.",
  "Answer ONLY from the provided context (transcripts, notes, video catalog). If the answer is not in the context, say so honestly.",
  "Detect the user's language and reply in it: English questions get English answers; Sinhala script gets Sinhala; Singlish (Sinhala written in Latin letters) gets simple Singlish or Sinhala.",
  "Always cite where in the video your answer comes from using [mm:ss] timestamps taken from the context.",
  "Format answers with simple Markdown: short paragraphs, **bold** for key terms, and '-' bullet lists. No headings or tables.",
  "Keep answers concise and conversational.",
].join("\n");

export const agents = {
  video: {
    modelEnvVar: "OPENROUTER_CHAT_MODEL",
    temperature: 0.3,
    maxHistoryMessages: 12,
    instructions: [
      sharedBehavior,
      "You are focused on ONE video. The full transcript and the user's timestamped notes are provided.",
    ].join("\n"),
    titleInstructions:
      "Name this chat about a single video. 3-6 words, same language as the conversation, plain text only, no quotes.",
  },
  library: {
    modelEnvVar: "OPENROUTER_CHAT_MODEL",
    temperature: 0.3,
    maxHistoryMessages: 12,
    instructions: [
      sharedBehavior,
      "You can see the user's whole video library. When you reference a video, name it and give the timestamp like: \"Video Title\" [mm:ss].",
    ].join("\n"),
    titleInstructions:
      "Name this library chat session. 3-6 words, same language as the conversation, plain text only, no quotes.",
  },
} satisfies Record<string, AgentConfig>;

export type AgentName = keyof typeof agents;
