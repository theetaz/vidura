FROM oven/bun:1.3.0-alpine

# yt-dlp (with Python) for robust YouTube transcript/metadata extraction —
# rotates player clients to get past YouTube's datacenter-IP bot wall.
RUN apk add --no-cache python3 py3-pip ffmpeg \
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
