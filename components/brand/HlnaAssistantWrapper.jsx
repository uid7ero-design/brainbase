'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useHelena } from '../../hooks/useHelena';
import { useAppStore } from '../../lib/state/useAppStore';
import { MicButton } from '../voice/MicButton';
import { ChatPanel } from '../chat/ChatPanel';
import { getContextForPath, resolveRoute } from '../../lib/dashboard/registry';

// Only used on service dashboards — BrainBase.jsx handles its own Helena at /dashboard
function HelenaLayer({ pathname }) {
  const router = useRouter();
  const helena = useHelena();
  const { chatOpen, setChatOpen, toggleChat, llmSource } = useAppStore();

  // Wire navigation: called when Helena returns action "navigate"
  useEffect(() => {
    helena.navRef.current = (target) => {
      const route = resolveRoute(target);
      if (route) router.push(route);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep dashboard context in sync with current route
  useEffect(() => {
    helena.dashboardContextRef.current = getContextForPath(pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Wake word: "Hey Helena"
  useEffect(() => {
    helena.enableWakeWord();
    return () => helena.disableWakeWord();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push-to-talk: hold Space
  useEffect(() => {
    let held = false;
    function onDown(e) {
      if (e.code !== 'Space' || held) return;
      if (e.target.tagName.match(/INPUT|TEXTAREA/i)) return;
      if (helena.conversational) return;
      e.preventDefault();
      held = true;
      helena.startListening();
    }
    function onUp(e) {
      if (e.code !== 'Space' || !held) return;
      e.preventDefault();
      held = false;
      helena.stopAndSend();
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helena.conversational]);

  // Ctrl+K to toggle chat, Esc to close
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
      }
      if (e.key === 'Escape') setChatOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleChat, setChatOpen]);

  return (
    <>
      <MicButton
        helena={helena}
        chatOpen={chatOpen}
        onChatToggle={toggleChat}
        llmSource={llmSource}
      />
      {chatOpen && (
        <ChatPanel
          messages={helena.messages}
          responding={helena.responding}
          transcript={helena.transcript}
          onSend={helena.sendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}
    </>
  );
}

export function HlnaAssistantWrapper() {
  const pathname = usePathname();
  // BrainBase.jsx at /dashboard manages its own Helena — don't double-up
  if (pathname === '/dashboard') return null;
  return <HelenaLayer pathname={pathname} />;
}
