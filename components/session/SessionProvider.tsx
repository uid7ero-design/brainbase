'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import LockScreen from './LockScreen';
import bannerStyles from './WelcomeBackBanner.module.css';

// ─── Config ───────────────────────────────────────────────────────────────────

const IDLE_MS = 10 * 60 * 1000;         // 10 min default
const IDLE_SECURE_MS = 5 * 60 * 1000;   // 5 min in secure mode
const HEARTBEAT_MS = 5 * 60 * 1000;     // refresh token every 5 min
const WELCOME_BACK_MS = 5 * 60 * 1000;  // show banner if away > 5 min

// ─── Context ──────────────────────────────────────────────────────────────────

interface SessionCtx {
  secureMode: boolean;
  setSecureModeOptimistic: (enabled: boolean) => void;
}

const SessionContext = createContext<SessionCtx>({
  secureMode: false,
  setSecureModeOptimistic: () => {},
});

export function useSessionContext() {
  return useContext(SessionContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
  hasSession: boolean;
  name: string;
  secureModeDefault: boolean;
}

export default function SessionProvider({ children, hasSession, name, secureModeDefault }: Props) {
  const [locked, setLocked] = useState(false);
  const [secureMode, setSecureMode] = useState(secureModeDefault);
  const [welcomeBack, setWelcomeBack] = useState(false);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const welcomeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Capture initial secureMode for effects that must not re-run on state change
  const secureModeRef = useRef(secureModeDefault);

  const idleMs = secureMode ? IDLE_SECURE_MS : IDLE_MS;

  // ── Idle timer ─────────────────────────────────────────────────────────────

  const resetIdle = useCallback(() => {
    if (!hasSession) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setLocked(true), idleMs);
  }, [hasSession, idleMs]);

  const unlock = useCallback(() => {
    setLocked(false);
    resetIdle();
  }, [resetIdle]);

  // ── Heartbeat (silent token refresh) ───────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    if (!hasSession) return;
    try {
      await fetch('/api/auth/refresh', { method: 'POST' });
    } catch { /* network error — session will expire naturally */ }
  }, [hasSession]);

  // ── Secure mode: logout on tab close ───────────────────────────────────────
  // sessionStorage is cleared when a tab is closed but survives navigation.
  // So: no 'hlna_tab' key = tab was closed and re-opened → logout.

  useEffect(() => {
    if (!hasSession) return;
    if (!secureModeRef.current) return;
    const alive = sessionStorage.getItem('hlna_tab');
    if (!alive) {
      // Tab was closed in secure mode — clear session and go to login
      fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
        window.location.replace('/login');
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once on mount

  useEffect(() => {
    if (!hasSession) return;
    sessionStorage.setItem('hlna_tab', '1');
  }, [hasSession]);

  // ── Activity listeners → reset idle timer ──────────────────────────────────

  useEffect(() => {
    if (!hasSession) return;
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    const handler = () => resetIdle();
    events.forEach(ev => window.addEventListener(ev, handler, { passive: true }));
    resetIdle();
    return () => {
      events.forEach(ev => window.removeEventListener(ev, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [hasSession, resetIdle]);

  // ── Heartbeat interval ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasSession) return;
    heartbeat.current = setInterval(sendHeartbeat, HEARTBEAT_MS);
    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current);
    };
  }, [hasSession, sendHeartbeat]);

  // ── Tab visibility → welcome back / session refresh ────────────────────────

  useEffect(() => {
    if (!hasSession) return;

    function handleVisibility() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        return;
      }

      const awayMs = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;

      // Refresh token on return regardless of how long they were away
      sendHeartbeat();

      // Show "Welcome back" if they were gone a meaningful amount of time
      // but the idle timer hasn't locked them (i.e. they came back quickly enough)
      if (awayMs > WELCOME_BACK_MS && !locked) {
        if (welcomeTimer.current) clearTimeout(welcomeTimer.current);
        setWelcomeBack(true);
        welcomeTimer.current = setTimeout(() => setWelcomeBack(false), 3500);
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (welcomeTimer.current) clearTimeout(welcomeTimer.current);
    };
  }, [hasSession, locked, sendHeartbeat]);

  // ── Context value ──────────────────────────────────────────────────────────

  function setSecureModeOptimistic(enabled: boolean) {
    setSecureMode(enabled);
    secureModeRef.current = enabled;
  }

  return (
    <SessionContext.Provider value={{ secureMode, setSecureModeOptimistic }}>
      {children}
      {hasSession && locked && <LockScreen name={name} onUnlock={unlock} />}
      {hasSession && welcomeBack && !locked && <WelcomeBackBanner name={name} />}
    </SessionContext.Provider>
  );
}

// ─── Welcome back banner ──────────────────────────────────────────────────────

function WelcomeBackBanner({ name }: { name: string }) {
  const firstName = name.split(' ')[0];
  // Visual (remaining visual islands pass): tokens via the CSS module instead
  // of the dark glass / violet glow chrome. Copy, placement, stacking and
  // pointer-events are unchanged; the dot is decorative.
  return (
    <div className={bannerStyles.banner}>
      <span aria-hidden="true" className={bannerStyles.dot} />
      <span className={bannerStyles.text}>
        Welcome back,{' '}
        <span className={bannerStyles.name}>{firstName}</span>
      </span>
    </div>
  );
}
