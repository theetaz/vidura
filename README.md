# yt-explora

yt-explora is planned as a mobile-first PWA for learning from YouTube videos across a language barrier. A user enters a YouTube URL, the system extracts or imports the transcript, translates it into Sinhala with an LLM through OpenRouter, overlays synchronized Sinhala subtitles on the embedded video, stores processed videos in a personal library, and supports chat over the video context.

The backend target is Supabase: Auth, Postgres, Storage, Edge Functions, Queues, Cron, and pgvector where needed. The frontend target is React, Vite, TypeScript, shadcn/ui, Tailwind CSS, and Zustand.
