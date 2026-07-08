import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vite";
import { YoutubeTranscript } from "youtube-transcript";

function devYouTubeTranscriptPlugin(): Plugin {
  return {
    name: "vidura-dev-youtube-transcript",
    configureServer(server) {
      server.middlewares.use("/api/dev/youtube-transcript", async (request, response) => {
        try {
          const requestUrl = new URL(
            request.url ?? "",
            "http://127.0.0.1",
          );
          const videoId = requestUrl.searchParams.get("videoId");

          if (!videoId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "videoId is required" }));
            return;
          }

          const [transcript, metadata] = await Promise.all([
            YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }),
            fetchYouTubeOEmbed(videoId),
          ]);

          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ transcript, metadata }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: error instanceof Error
                ? error.message
                : "Could not fetch transcript",
            }),
          );
        }
      });
    },
  };
}

async function fetchYouTubeOEmbed(videoId: string) {
  const response = await fetch(
    `https://www.youtube.com/oembed?url=${
      encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
    }&format=json`,
  );

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as Record<string, unknown>;

  return {
    title: typeof payload.title === "string" ? payload.title : null,
    channelTitle: typeof payload.author_name === "string"
      ? payload.author_name
      : null,
    thumbnailUrl: typeof payload.thumbnail_url === "string"
      ? payload.thumbnail_url
      : null,
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devYouTubeTranscriptPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Vidura",
        short_name: "Vidura",
        description:
          "AI-translated Sinhala subtitles and transcript-grounded chat for YouTube learning.",
        theme_color: "#fff8e7",
        background_color: "#fff8e7",
        display: "standalone",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/vidura-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/vidura-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/",
        // Layer our push/notificationclick handlers onto the generated SW.
        importScripts: ["/sw-push.js"]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
