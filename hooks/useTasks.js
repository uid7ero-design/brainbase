'use client';
import { useState, useEffect, useCallback } from 'react';

const KEY = 'brainbase:tasks';
const EVT = 'brainbase:tasks-changed';

function load() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? []; } catch { return []; }
}

function save(tasks) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

export function getTaskContext() {
  const tasks = load();
  const pending = tasks.filter(t => !t.done);
  if (pending.length === 0) return 'No active tasks.';
  return `${pending.length} active task${pending.length !== 1 ? 's' : ''}: ${pending.map(t => `"${t.text}"`).join(', ')}.`;
}

export function useTasks() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const reload = () => setTasks(load());
    reload();
    window.addEventListener(EVT, reload);
    return () => window.removeEventListener(EVT, reload);
  }, []);

  const add = useCallback((text) => {
    if (!text?.trim()) return;
    const next = [...load(), { id: Date.now(), text: text.trim(), done: false }];
    save(next);
    setTasks(next);
  }, []);

  const toggle = useCallback((id) => {
    const next = load().map(t => t.id === id ? { ...t, done: !t.done } : t);
    save(next);
    setTasks(next);
  }, []);

  const remove = useCallback((id) => {
    const next = load().filter(t => t.id !== id);
    save(next);
    setTasks(next);
  }, []);

  const completeByText = useCallback((query) => {
    const lower = query.toLowerCase();
    const next = load().map(t => t.text.toLowerCase().includes(lower) ? { ...t, done: true } : t);
    save(next);
    setTasks(next);
  }, []);

  const clearDone = useCallback(() => {
    const next = load().filter(t => !t.done);
    save(next);
    setTasks(next);
  }, []);

  return { tasks, add, toggle, remove, completeByText, clearDone };
}
