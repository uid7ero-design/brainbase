import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { INIT_ITEMS } from '../data/activities';

export const useAppStore = create(
  persist(
    (set) => ({
      // ── Panels ──────────────────────────────────────────────────
      sidebarOpen:       true,
      panelOpen:         true,
      chatOpen:          false,
      memoryPanelOpen:   false,
      brainGraphOpen:    false,
      newsOpen:          false,
      integrationsOpen:  false,
      inboxOpen:         false,
      contactsOpen:      false,

      setSidebarOpen:      (v) => set({ sidebarOpen: v }),
      setPanelOpen:        (v) => set({ panelOpen: v }),
      setChatOpen:         (v) => set({ chatOpen: v }),
      setMemoryPanelOpen:  (v) => set({ memoryPanelOpen: v }),
      setBrainGraphOpen:   (v) => set({ brainGraphOpen: v }),
      setNewsOpen:         (v) => set({ newsOpen: v }),
      setIntegrationsOpen: (v) => set({ integrationsOpen: v }),
      setInboxOpen:        (v) => set({ inboxOpen: v }),
      setContactsOpen:     (v) => set({ contactsOpen: v }),

      toggleSidebar:      () => set(s => ({ sidebarOpen:      !s.sidebarOpen })),
      togglePanel:        () => set(s => ({ panelOpen:        !s.panelOpen })),
      toggleChat:         () => set(s => ({ chatOpen:         !s.chatOpen })),
      toggleMemoryPanel:  () => set(s => ({ memoryPanelOpen:  !s.memoryPanelOpen })),
      toggleBrainGraph:   () => set(s => ({ brainGraphOpen:   !s.brainGraphOpen })),
      toggleNews:         () => set(s => ({ newsOpen:         !s.newsOpen })),
      toggleIntegrations: () => set(s => ({ integrationsOpen: !s.integrationsOpen })),
      toggleInbox:        () => set(s => ({ inboxOpen:        !s.inboxOpen })),
      toggleContacts:     () => set(s => ({ contactsOpen:     !s.contactsOpen })),

      // ── Navigation ──────────────────────────────────────────────
      activeNav:    'Dashboard',
      setActiveNav: (nav) => set({ activeNav: nav }),

      // ── Activity feed ────────────────────────────────────────────
      items:    INIT_ITEMS,
      latestId: null,
      addItem:     (item) => set(s => ({ items: [...s.items, item], latestId: item.id })),
      clearLatest: ()     => set({ latestId: null }),

      // ── Floating response cards ──────────────────────────────────
      cards:       [],
      addCard:     (card) => set(s => ({ cards: [...s.cards.slice(-2), card] })),
      removeCard:  (id)   => set(s => ({ cards: s.cards.filter(c => c.id !== id) })),
      clearCards:  ()     => set({ cards: [] }),

      // ── LLM source indicator ─────────────────────────────────────
      llmSource: null,
      setLlmSource: (src) => set({ llmSource: src }),

      // ── Dashboard AI context (set by active dashboard page) ──────
      dashboardAiContext: '',
      setDashboardAiContext: (ctx) => set({ dashboardAiContext: ctx }),

      // ── Helena message trigger (fire a message from outside the hook) ──
      helenaTrigger: null,
      fireHelena: (msg) => set({ helenaTrigger: msg }),
      clearHelenaTrigger: () => set({ helenaTrigger: null }),

      // ── Orb alert state (set when HLNA detects an anomaly) ──────
      orbAlert: false,
      setOrbAlert: (v) => set({ orbAlert: v }),
      clearOrbAlert: () => set({ orbAlert: false }),

      // ── Notification badge ───────────────────────────────────────
      notificationCount: 3,

      // ── Active module (module-aware HLNA context) ────────────────
      activeModule:    null,     // e.g. 'waste_recycling'
      setActiveModule: (key) => set({ activeModule: key }),

      enabledModules:    [],     // [{ key, name, industry }]
      setEnabledModules: (mods) => set({ enabledModules: mods }),
    }),
    {
      name: 'brainbase-state',
      // Only persist UI layout preferences — not ephemeral runtime state
      partialize: (state) => ({
        sidebarOpen:  state.sidebarOpen,
        panelOpen:    state.panelOpen,
        activeNav:    state.activeNav,
        activeModule: state.activeModule,
      }),
    }
  )
);
