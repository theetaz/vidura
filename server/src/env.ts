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
  // Optional HTTP/HTTPS proxy for YouTube requests. YouTube blocks datacenter
  // IPs ("Sign in to confirm you're not a bot"); routing through a residential
  // proxy makes server-side transcript fetching work. Empty = direct.
  youtubeProxyUrl: optional("YOUTUBE_PROXY_URL"),
  // Optional Netscape-format cookies file (path inside the container). Cookies
  // from a logged-in YouTube session let yt-dlp bypass the bot wall on a
  // flagged datacenter IP. Used only when the file exists.
  youtubeCookiesFile: optional("YOUTUBE_COOKIES_FILE"),
  // Open-source bgutil PO-token provider (sidecar container). Supplies
  // BotGuard proof-of-origin tokens so yt-dlp passes YouTube's bot wall from
  // a datacenter IP without cookies or proxies.
  potProviderUrl: optional("POT_PROVIDER_URL"),
  // Official Google APIs (recommended): Gemini ingests public YouTube URLs on
  // Google's own infrastructure for transcription, and the YouTube Data API
  // serves exact metadata. One Cloud Console API key can serve both when the
  // "Generative Language API" and "YouTube Data API v3" are enabled.
  geminiApiKey: optional("GEMINI_API_KEY"),
  geminiModel: optional("GEMINI_MODEL", "gemini-2.5-flash"),
  youtubeApiKey: optional("YOUTUBE_API_KEY"),
  // Email/password is a local-testing convenience; production uses Google only.
  emailPasswordAuth: optional("AUTH_EMAIL_PASSWORD", "false") === "true",
  get googleEnabled() {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
};
