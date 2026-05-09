"use client";
import { useCallback, useEffect, useRef } from "react";

const HOME             = { x: 24, y: 20 };
const W                = 150;
const H                = 88;   // maintains 360:210 aspect ratio
const BOUNCE_DURATION  = 18_000;
const INTERVAL         = 22_000;
const GRAVITY          = 0.32;
const RESTITUTION      = 0.78;
const WALL_RESTITUTION = 0.92;
const MIN_BOUNCE_VY    = 3;

type Phase = "idle" | "bouncing" | "rolling";

export default function BouncingLogo() {
  const divRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const s = useRef({
    x: HOME.x, y: HOME.y,
    vx: 0, vy: 0,
    phase: "idle" as Phase,
    startTime: 0,
    active: false,
  });

  const setTransform = (x: number, y: number) => {
    if (divRef.current) divRef.current.style.transform = `translate(${x}px, ${y}px)`;
  };

  const animate = useCallback((timestamp: number) => {
    const state = s.current;
    const div = divRef.current;
    if (!div) return;
    const VW = window.innerWidth;
    const VH = window.innerHeight;

    if (state.phase === "bouncing") {
      state.vy += GRAVITY;
      state.x  += state.vx;
      state.y  += state.vy;

      // Side walls
      if (state.x <= 0) {
        state.x  = 0;
        state.vx = Math.abs(state.vx) * WALL_RESTITUTION;
      } else if (state.x >= VW - W) {
        state.x  = VW - W;
        state.vx = -Math.abs(state.vx) * WALL_RESTITUTION;
      }

      // Ceiling
      if (state.y <= 0) {
        state.y  = 0;
        state.vy = Math.abs(state.vy) * RESTITUTION;
      }

      // Floor
      if (state.y >= VH - H) {
        state.y  = VH - H;
        const bounced = Math.abs(state.vy) * RESTITUTION;
        state.vy = -(bounced < MIN_BOUNCE_VY ? MIN_BOUNCE_VY : bounced);
      }

      setTransform(state.x, state.y);
      if (timestamp - state.startTime > BOUNCE_DURATION) state.phase = "rolling";
      rafRef.current = requestAnimationFrame(animate);

    } else if (state.phase === "rolling") {
      state.vy += GRAVITY;
      state.x  += state.vx;
      state.y  += state.vy;

      if (state.y >= VH - H) {
        state.y  = VH - H;
        const bounced = Math.abs(state.vy) * RESTITUTION;
        state.vy = -(bounced < 0.8 ? 0 : bounced);
      }

      if (state.x < -W || state.x > VW + W || state.y > VH + H) {
        div.style.display = "none";
        state.phase  = "idle";
        state.active = false;
        return;
      }

      setTransform(state.x, state.y);
      rafRef.current = requestAnimationFrame(animate);
    }
  }, []);

  const launch = useCallback(() => {
    const state = s.current;
    if (state.active) return;

    const dir    = Math.random() > 0.5 ? 1 : -1;
    const hSpeed = 6 + Math.random() * 5;
    const vSpeed = -(2 + Math.random() * 4);

    state.active    = true;
    state.phase     = "bouncing";
    state.x         = HOME.x;
    state.y         = HOME.y;
    state.vx        = hSpeed * dir;
    state.vy        = vSpeed;
    state.startTime = performance.now();

    const div = divRef.current;
    if (div) { setTransform(HOME.x, HOME.y); div.style.display = "block"; }
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => {
    const first  = setTimeout(launch, 3_000);
    const repeat = setInterval(launch, INTERVAL);
    return () => { clearTimeout(first); clearInterval(repeat); cancelAnimationFrame(rafRef.current); };
  }, [launch]);

  return (
    <div
      ref={divRef}
      style={{
        display: "none", position: "fixed", top: 0, left: 0,
        width: W, height: H,
        zIndex: 9999, pointerEvents: "none", willChange: "transform",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ld-tennis-ball.svg"
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
