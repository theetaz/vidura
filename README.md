# Vidura

Vidura is a mobile-first PWA for learning from YouTube videos across a language
barrier. A user enters a YouTube URL, the system fetches the transcript,
translates it into Sinhala with an LLM through OpenRouter, overlays synchronized
Sinhala subtitles on the embedded video, stores processed videos in a personal
library, and supports chat over the video context.

## Architecture

- **Frontend** — React, Vite, TypeScript, shadcn/ui, Tailwind CSS, Zustand,
  TanStack Query. Deployed to Cloudflare Pages.
- **Backend** (`server/`) — a self-hosted Bun + Hono API with better-auth
  (Google OAuth), Postgres, and pg-boss durable jobs, run via Docker Compose on
  a VPS behind nginx. Realtime updates stream over SSE (Postgres LISTEN/NOTIFY).
- **Transcripts** — YouTube blocks datacenter IPs, so the server never scrapes
  YouTube directly. Transcripts come from the Gemini API (Google fetches the
  public URL on its own infrastructure); metadata from the YouTube Data API or
  the keyless oembed endpoint. Desktop users can alternatively push a transcript
  from a browser userscript (`server/public/transcript-helper.user.js`).
- **Translation & chat** — OpenRouter (DeepSeek for translation).

See `server/README` notes and `server/.env.example` for configuration.
