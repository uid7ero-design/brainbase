'use client';
import { useState, useCallback } from 'react';
import { memoryManager } from './memoryManager';

export function useHelenaMemory() {
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate(n => n + 1);

  const remember = useCallback((fact, type = 'long') => {
    memoryManager.remember(fact, type);
    refresh();
  }, []);

  const forget = useCallback((query) => {
    memoryManager.forget(query);
    refresh();
  }, []);

  const setPreference = useCallback((key, value) => {
    memoryManager.setPreference(key, value);
    refresh();
  }, []);

  return {
    remember,
    forget,
    setPreference,
    getPreferences:   memoryManager.getPreferences.bind(memoryManager),
    getContext:       memoryManager.getContext.bind(memoryManager),
    getRecentHistory: memoryManager.getRecentHistory.bind(memoryManager),
    logExchange:      memoryManager.logExchange.bind(memoryManager),
    clearAll:         memoryManager.clearAll.bind(memoryManager),
  };
}
