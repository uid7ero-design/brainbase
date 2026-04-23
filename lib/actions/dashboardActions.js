import { useAppStore } from '../state/useAppStore';
import { memoryManager } from '../memory/memoryManager';

// ── Text-command path (local parser intercept) ────────────────────────────
export function executeCommand(cmd, clearHistory) {
  const store = useAppStore.getState();

  switch (cmd.action) {
    case 'open_chat':    store.setChatOpen(true);    return "Chat is open.";
    case 'close_chat':   store.setChatOpen(false);   return "Chat closed.";
    case 'open_sidebar': store.setSidebarOpen(true); return "Sidebar expanded.";
    case 'close_sidebar':store.setSidebarOpen(false);return "Sidebar collapsed.";
    case 'open_panel':   store.setPanelOpen(true);   return "Activity panel expanded.";
    case 'close_panel':  store.setPanelOpen(false);  return "Activity panel collapsed.";
    case 'show_memory':  store.setMemoryPanelOpen(true); return "Opening memory manager.";

    case 'remember': {
      const fact = cmd.match[1]?.trim();
      if (!fact) return "What would you like me to remember?";
      memoryManager.remember(fact, 'long');
      return "Got it — I'll remember that.";
    }
    case 'forget': {
      const query = cmd.match[1]?.trim();
      if (!query) return "What would you like me to forget?";
      memoryManager.forget(query);
      return "Done — cleared from memory.";
    }
    case 'clear_memory':
      memoryManager.clearAll();
      return "Memory cleared.";
    case 'clear_chat':
      clearHistory?.();
      return "Chat history cleared.";
    case 'nav': {
      const target = cmd.target;
      store.setActiveNav(target);
      if (target === 'Memory') store.setMemoryPanelOpen(true);
      return `Showing ${target}.`;
    }
    default:
      return null;
  }
}

// ── Structured-action path (Helena JSON response field) ───────────────────
export function executeStructuredAction(action, target, clearHistory) {
  if (!action || action === 'none') return;

  const store = useAppStore.getState();

  switch (action) {
    case 'open_chat':    store.setChatOpen(true);        break;
    case 'close_chat':   store.setChatOpen(false);       break;
    case 'open_sidebar': store.setSidebarOpen(true);     break;
    case 'close_sidebar':store.setSidebarOpen(false);    break;
    case 'open_panel':   store.setPanelOpen(true);       break;
    case 'close_panel':  store.setPanelOpen(false);      break;
    case 'show_memory':  store.setMemoryPanelOpen(true); break;
    case 'clear_chat':   clearHistory?.();               break;
    case 'navigate': {
      if (!target || target === 'none') break;
      const nav = target.charAt(0).toUpperCase() + target.slice(1);
      store.setActiveNav(nav);
      if (nav === 'Memory') store.setMemoryPanelOpen(true);
      break;
    }
  }
}
