/**
 * Zustand store — replaces all localStorage usage.
 *
 * State here is UI-only (active module, sidebar, filters in-flight).
 * Persisted data always lives in the DB via API routes.
 */

import { create } from "zustand";
import { Module } from "@prisma/client";

interface OrgState {
  organisation_id: string | null;
  user_id: string | null;
}

interface UIState {
  activeModule:  Module | null;
  sidebarOpen:   boolean;
  uploadDrawerOpen: boolean;
  activeFilters: Record<string, unknown>;
}

interface BrainbaseStore extends OrgState, UIState {
  setOrg:              (id: string, userId?: string) => void;
  setActiveModule:     (m: Module | null) => void;
  setSidebarOpen:      (v: boolean) => void;
  setUploadDrawerOpen: (v: boolean) => void;
  setActiveFilter:     (key: string, value: unknown) => void;
  clearFilters:        () => void;
}

export const useBrainbaseStore = create<BrainbaseStore>(set => ({
  // Org context — set on auth
  organisation_id: null,
  user_id:         null,
  setOrg: (id, userId) => set({ organisation_id: id, user_id: userId ?? null }),

  // UI state
  activeModule:     null,
  sidebarOpen:      true,
  uploadDrawerOpen: false,
  activeFilters:    {},

  setActiveModule:     m  => set({ activeModule: m }),
  setSidebarOpen:      v  => set({ sidebarOpen: v }),
  setUploadDrawerOpen: v  => set({ uploadDrawerOpen: v }),
  setActiveFilter: (key, value) =>
    set(s => ({ activeFilters: { ...s.activeFilters, [key]: value } })),
  clearFilters: () => set({ activeFilters: {} }),
}));
