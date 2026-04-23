import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { INIT_ITEMS } from '../data/activities';

export const useAppStore = create(
  persist(
    (set) => ({
      // ── Panels ──────────────────────────────────────────────────
      sidebarOpen:     true,
      panelOpen:       true,
      chatOpen:        false,
      memoryPanelOpen: false,
      brainGraphOpen:  false,
      newsOpen:        false,

      setSidebarOpen:    (v) => set({ sidebarOpen: v }),
      setPanelOpen:      (v) => set({ panelOpen: v }),
      setChatOpen:       (v) => set({ chatOpen: v }),
      setMemoryPanelOpen:(v) => set({ memoryPanelOpen: v }),
      setBrainGraphOpen: (v) => set({ brainGraphOpen: v }),
      setNewsOpen:       (v) => set({ newsOpen: v }),

      toggleSidebar:     () => set(s => ({ sidebarOpen:     !s.sidebarOpen })),
      togglePanel:       () => set(s => ({ panelOpen:       !s.panelOpen })),
      toggleChat:        () => set(s => ({ chatOpen:        !s.chatOpen })),
      toggleMemoryPanel: () => set(s => ({ memoryPanelOpen: !s.memoryPanelOpen })),
      toggleBrainGraph:  () => set(s => ({ brainGraphOpen:  !s.brainGraphOpen })),
      toggleNews:        () => set(s => ({ newsOpen:        !s.newsOpen })),

      // ── Navigation ──────────────────────────────────────────────
      activeNav:    'Dashboard',
      setActiveNav: (nav) => set({ activeNav: nav }),

      // ── Activity feed ────────────────────────────────────────────
      items:    INIT_ITEMS,
      latestId: null,
      addItem:     (item) => set(s => ({ items: [...s.items, item], latestId: item.id })),
      clearLatest: ()     => set({ latestId: null }),

      // ── Floating response cards ──────────────────────────────────
      cards:      [],
      addCard:    (card) => set(s => ({ cards: [...s.cards.slice(-2), card] })),
      clearCards: ()     => set({ cards: [] }),

      // ── LLM source indicator ─────────────────────────────────────
      llmSource: null,
      setLlmSource: (src) => set({ llmSource: src }),

      // ── Notification badge ───────────────────────────────────────
      notificationCount: 3,
    }),
    {
      name: 'brainbase-state',
      // Only persist UI layout preferences — not ephemeral runtime state
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        panelOpen:   state.panelOpen,
        activeNav:   state.activeNav,
      }),
    }
  )
);
