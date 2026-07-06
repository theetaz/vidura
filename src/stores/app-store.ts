import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AppView = "library" | "add" | "watch" | "chat" | "settings";
export type SubtitlePlacement = "overlay" | "below";

type AppState = {
  selectedVideoId: string | null;
  subtitleEnabled: boolean;
  subtitlePlacement: SubtitlePlacement;
  subtitleSize: number;
  subtitleOpacity: number;
  transcriptCollapsed: boolean;
  selectVideo: (videoId: string) => void;
  setSelectedVideoId: (videoId: string | null) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitlePlacement: (placement: SubtitlePlacement) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
  setTranscriptCollapsed: (collapsed: boolean) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedVideoId: null,
      subtitleEnabled: true,
      subtitlePlacement: "below",
      subtitleSize: 20,
      subtitleOpacity: 82,
      transcriptCollapsed: false,
      selectVideo: (selectedVideoId) => set({ selectedVideoId }),
      setSelectedVideoId: (selectedVideoId) => set({ selectedVideoId }),
      setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
      setSubtitlePlacement: (subtitlePlacement) => set({ subtitlePlacement }),
      setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
      setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
      setTranscriptCollapsed: (transcriptCollapsed) =>
        set({ transcriptCollapsed }),
    }),
    {
      name: "vidura-ui-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedVideoId: state.selectedVideoId,
        subtitleEnabled: state.subtitleEnabled,
        subtitlePlacement: state.subtitlePlacement,
        subtitleSize: state.subtitleSize,
        subtitleOpacity: state.subtitleOpacity,
        transcriptCollapsed: state.transcriptCollapsed,
      }),
    },
  ),
);
