// Centralized, validated environment access. Fail fast on missing required
// values so misconfiguration surfaces at boot rather than at first request.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  apiBaseUrl: optional("API_BASE_URL", "http://localhost:8787"),
  webOrigin: optional("WEB_ORIGIN", "http://localhost:5173"),
  authSecret: required("BETTER_AUTH_SECRET"),
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  openRouterApiKey: optional("OPENROUTER_API_KEY"),
  openRouterModel: optional("OPENROUTER_MODEL", "deepseek/deepseek-chat"),
  openRouterChatModel: optional("OPENROUTER_CHAT_MODEL"),
  port: Number(optional("PORT", "8787")),
  // Transcript + metadata via official Google APIs (Google fetches the public
  // YouTube URL on its own infrastructure, so the VPS IP block is irrelevant).
  // Gemini transcribes; the YouTube Data API serves exact metadata. One Cloud
  // Console API key can serve both when "Generative Language API" and "YouTube
  // Data API v3" are enabled on the project.
  geminiApiKey: optional("GEMINI_API_KEY"),
  geminiModel: optional("GEMINI_MODEL", "gemini-2.5-flash-lite"),
  youtubeApiKey: optional("YOUTUBE_API_KEY"),
  // Email/password is a local-testing convenience; production uses Google only.
  emailPasswordAuth: optional("AUTH_EMAIL_PASSWORD", "false") === "true",
  get googleEnabled() {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
};
