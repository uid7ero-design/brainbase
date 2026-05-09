"use client";
import { useCallback, useEffect, useRef } from "react";

const HOME             = { x: 24, y: 20 };
const SIZE             = 44;
const BOUNCE_DURATION  = 14_000;
const INTERVAL         = 30_000;
const GRAVITY          = 0.3;
const RESTITUTION      = 0.76;
const WALL_RESTITUTION = 0.92;
const MIN_BOUNCE_VY    = 3;

type Phase = "idle" | "bouncing" | "rolling";

export default function BouncingLogo() {
  const divRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const s = useRef({
    x: HOME.x, y: HOME.y,
    vx: 0, vy: 0,
    rotation: 0,
    phase: "idle" as Phase,
    startTime: 0,
    active: false,
  });

  const setTransform = (x: number, y: number, rot: number) => {
    if (divRef.current) divRef.current.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  };

  const animate = useCallback((timestamp: number) => {
    const state = s.current;
    const div = divRef.current;
    if (!div) return;
    const W = window.innerWidth;
    const H = window.innerHeight;

    if (state.phase === "bouncing") {
      state.vy += GRAVITY;
      state.x  += state.vx;
      state.y  += state.vy;
      state.rotation += state.vx * 2.5;

      if (state.x <= 0) {
        state.x  = 0;
        state.vx = Math.abs(state.vx) * WALL_RESTITUTION;
      } else if (state.x >= W - SIZE) {
        state.x  = W - SIZE;
        state.vx = -Math.abs(state.vx) * WALL_RESTITUTION;
      }

      if (state.y <= 0) {
        state.y  = 0;
        state.vy = Math.abs(state.vy) * RESTITUTION;
      }

      if (state.y >= H - SIZE) {
        state.y  = H - SIZE;
        const bounced = Math.abs(state.vy) * RESTITUTION;
        state.vy = -(bounced < MIN_BOUNCE_VY ? MIN_BOUNCE_VY : bounced);
      }

      setTransform(state.x, state.y, state.rotation);
      if (timestamp - state.startTime > BOUNCE_DURATION) state.phase = "rolling";
      rafRef.current = requestAnimationFrame(animate);

    } else if (state.phase === "rolling") {
      state.vy += GRAVITY;
      state.x  += state.vx;
      state.y  += state.vy;
      state.rotation += state.vx * 2.5;

      if (state.y >= H - SIZE) {
        state.y  = H - SIZE;
        const bounced = Math.abs(state.vy) * RESTITUTION;
        state.vy = -(bounced < 0.8 ? 0 : bounced);
      }

      if (state.x < -SIZE || state.x > W + SIZE || state.y > H + SIZE) {
        div.style.display = "none";
        state.phase  = "idle";
        state.active = false;
        return;
      }

      setTransform(state.x, state.y, state.rotation);
      rafRef.current = requestAnimationFrame(animate);
    }
  }, []);

  const launch = useCallback(() => {
    const state = s.current;
    if (state.active) return;

    const dir    = Math.random() > 0.5 ? 1 : -1;
    const hSpeed = 7 + Math.random() * 5;
    const vSpeed = -(2 + Math.random() * 4);

    state.active    = true;
    state.phase     = "bouncing";
    state.x         = HOME.x;
    state.y         = HOME.y;
    state.vx        = hSpeed * dir;
    state.vy        = vSpeed;
    state.rotation  = 0;
    state.startTime = performance.now();

    const div = divRef.current;
    if (div) { setTransform(HOME.x, HOME.y, 0); div.style.display = "block"; }
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => {
    const first  = setTimeout(launch, 4_000);
    const repeat = setInterval(launch, INTERVAL);
    return () => { clearTimeout(first); clearInterval(repeat); cancelAnimationFrame(rafRef.current); };
  }, [launch]);

  return (
    <div ref={divRef} style={{ display: "none", position: "fixed", top: 0, left: 0, width: SIZE, height: SIZE, zIndex: 9999, pointerEvents: "none", willChange: "transform" }}>
      <svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%" }}>
        <circle cx="22" cy="22" r="21" fill="#c9e219" />
        <circle cx="22" cy="22" r="21" fill="none" stroke="#afc912" strokeWidth="1" />
        <path d="M6,12 C13,17 13,27 6,32"  stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M38,12 C31,17 31,27 38,32" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M6,12 C13,5 31,5 38,12"   stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M6,32 C13,39 31,39 38,32"  stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
