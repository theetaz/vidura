import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { videoQueryKeys } from "@/features/videos/api";
import { supabase } from "@/lib/supabase";

const realtimeTables = [
  "videos",
  "processing_jobs",
  "transcript_segments",
  "translated_segments",
  "chat_threads",
  "chat_messages",
] as const;

export function useVideoRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !supabase) {
      return;
    }

    const client = supabase;
    const channel = client.channel("vidura-data-sync");

    for (const table of realtimeTables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          void queryClient.invalidateQueries({
            queryKey: videoQueryKeys.all,
          });

          const row = payload.new ?? payload.old;
          const videoId = getVideoId(row);

          if (videoId) {
            void queryClient.invalidateQueries({
              queryKey: videoQueryKeys.detail(videoId),
            });
            void queryClient.invalidateQueries({
              queryKey: videoQueryKeys.transcript(videoId),
            });
            void queryClient.invalidateQueries({
              queryKey: videoQueryKeys.chat(videoId),
            });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}

function getVideoId(row: unknown) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;

  if (typeof record.video_id === "string") {
    return record.video_id;
  }

  if (typeof record.id === "string") {
    return record.id;
  }

  return null;
}
