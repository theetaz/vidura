FROM oven/bun:1.3.0-alpine

# Transcripts come from Gemini (Google fetches the YouTube URL) — no yt-dlp,
# Python, or media tooling needed in the image.
WORKDIR /app

# Install dependencies against the committed lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

# API by default; the worker service overrides the command.
CMD ["bun", "run", "src/index.ts"]
