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
          void queryClient.refetchQueries({
            queryKey: videoQueryKeys.all,
            type: "active",
          });

          const row = payload.new ?? payload.old;
          const videoId = getVideoId(row);

          if (videoId) {
            void queryClient.refetchQueries({
              queryKey: videoQueryKeys.detail(videoId),
              type: "active",
            });
            void queryClient.refetchQueries({
              queryKey: videoQueryKeys.transcript(videoId),
              type: "active",
            });
            void queryClient.refetchQueries({
              queryKey: videoQueryKeys.chat(videoId),
              type: "active",
            });
          }
        },
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void queryClient.refetchQueries({
          queryKey: videoQueryKeys.all,
          type: "active",
        });
      }
    });

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
