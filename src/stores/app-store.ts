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
  subtitleTextColor: string;
  subtitleBgColor: string;
  // Distance of the on-video subtitle from the bottom, as a % of player height.
  subtitlePosition: number;
  transcriptCollapsed: boolean;
  selectVideo: (videoId: string) => void;
  setSelectedVideoId: (videoId: string | null) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitlePlacement: (placement: SubtitlePlacement) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
  setSubtitleTextColor: (value: string) => void;
  setSubtitleBgColor: (value: string) => void;
  setSubtitlePosition: (value: number) => void;
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
      subtitleTextColor: "#ffffff",
      subtitleBgColor: "#111827",
      subtitlePosition: 6,
      transcriptCollapsed: false,
      selectVideo: (selectedVideoId) => set({ selectedVideoId }),
      setSelectedVideoId: (selectedVideoId) => set({ selectedVideoId }),
      setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
      setSubtitlePlacement: (subtitlePlacement) => set({ subtitlePlacement }),
      setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
      setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
      setSubtitleTextColor: (subtitleTextColor) => set({ subtitleTextColor }),
      setSubtitleBgColor: (subtitleBgColor) => set({ subtitleBgColor }),
      setSubtitlePosition: (subtitlePosition) => set({ subtitlePosition }),
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
        subtitleTextColor: state.subtitleTextColor,
        subtitleBgColor: state.subtitleBgColor,
        subtitlePosition: state.subtitlePosition,
        transcriptCollapsed: state.transcriptCollapsed,
      }),
    },
  ),
);

// Hex (#rrggbb) → "r g b" for CSS rgb() with a separate alpha.
export function hexToRgbChannels(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "17 24 39";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
