import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AppView = "library" | "add" | "watch" | "chat" | "settings";

type AppState = {
  selectedVideoId: string | null;
  subtitleEnabled: boolean;
  subtitleSize: number;
  subtitleOpacity: number;
  selectVideo: (videoId: string) => void;
  setSelectedVideoId: (videoId: string | null) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedVideoId: null,
      subtitleEnabled: true,
      subtitleSize: 20,
      subtitleOpacity: 82,
      selectVideo: (selectedVideoId) => set({ selectedVideoId }),
      setSelectedVideoId: (selectedVideoId) => set({ selectedVideoId }),
      setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
      setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
      setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
    }),
    {
      name: "vidura-ui-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedVideoId: state.selectedVideoId,
        subtitleEnabled: state.subtitleEnabled,
        subtitleSize: state.subtitleSize,
        subtitleOpacity: state.subtitleOpacity,
      }),
    },
  ),
);
