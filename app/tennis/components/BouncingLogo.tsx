"use client";
import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";

const HOME = { x: 24, y: 20 };
const SIZE = 44;
const SPEED = 5.5;
const BOUNCE_DURATION = 8_000;
const INTERVAL = 30_000;

type Phase = "idle" | "bouncing" | "returning";

export default function BouncingLogo() {
  const divRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const s = useRef({ x: HOME.x, y: HOME.y, vx: 0, vy: 0, rotation: 0, phase: "idle" as Phase, startTime: 0, active: false });

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
      state.x += state.vx;
      state.y += state.vy;
      state.rotation += state.vx * 3;
      if (state.x <= 0) { state.x = 0; state.vx = Math.abs(state.vx); }
      else if (state.x >= W - SIZE) { state.x = W - SIZE; state.vx = -Math.abs(state.vx); }
      if (state.y <= 0) { state.y = 0; state.vy = Math.abs(state.vy); }
      else if (state.y >= H - SIZE) { state.y = H - SIZE; state.vy = -Math.abs(state.vy); }
      setTransform(state.x, state.y, state.rotation);
      if (timestamp - state.startTime > BOUNCE_DURATION) state.phase = "returning";
      rafRef.current = requestAnimationFrame(animate);
    } else if (state.phase === "returning") {
      const dx = HOME.x - state.x;
      const dy = HOME.y - state.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1.5) {
        setTransform(HOME.x, HOME.y, 0);
        div.style.display = "none";
        state.phase = "idle";
        state.active = false;
        return;
      }
      state.x += dx * 0.1;
      state.y += dy * 0.1;
      state.rotation *= 0.88;
      setTransform(state.x, state.y, state.rotation);
      rafRef.current = requestAnimationFrame(animate);
    }
  }, []);

  const launch = useCallback(() => {
    const state = s.current;
    if (state.active) return;
    let angle: number;
    do { angle = Math.random() * Math.PI * 2; } while (Math.abs(Math.cos(angle)) < 0.25 || Math.abs(Math.sin(angle)) < 0.25);
    state.active = true; state.phase = "bouncing";
    state.x = HOME.x; state.y = HOME.y;
    state.vx = Math.cos(angle) * SPEED; state.vy = Math.sin(angle) * SPEED;
    state.rotation = 0; state.startTime = performance.now();
    const div = divRef.current;
    if (div) { setTransform(HOME.x, HOME.y, 0); div.style.display = "block"; }
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => {
    const first = setTimeout(launch, 4_000);
    const repeat = setInterval(launch, INTERVAL);
    return () => { clearTimeout(first); clearInterval(repeat); cancelAnimationFrame(rafRef.current); };
  }, [launch]);

  return (
    <div ref={divRef} style={{ display: "none", position: "fixed", top: 0, left: 0, width: SIZE, height: SIZE, zIndex: 9999, pointerEvents: "none", willChange: "transform" }} className="rounded-full overflow-hidden border-2 border-white/25 shadow-2xl shadow-black/60">
      <Image src="/logo.jpg" alt="" fill className="object-cover" sizes="44px" priority />
    </div>
  );
}
