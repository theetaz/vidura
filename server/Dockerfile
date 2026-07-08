FROM oven/bun:1.3.0-alpine

# yt-dlp fetches YouTube's own caption track (frame-accurate) through the
# residential proxy. Without a proxy it's unused and Gemini handles transcripts.
RUN apk add --no-cache python3 py3-pip \
  && pip install --break-system-packages --no-cache-dir -U yt-dlp

WORKDIR /app

# Install dependencies against the committed lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

# API by default; the worker service overrides the command.
CMD ["bun", "run", "src/index.ts"]
