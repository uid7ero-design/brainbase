'use client';
import { useEffect, useRef } from 'react';

const SIZE = 52;
const SPEED = 3;

export default function BouncingBall() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let x = Math.random() * (window.innerWidth - SIZE);
    let y = Math.random() * (window.innerHeight - SIZE);
    const angle = Math.random() * Math.PI * 2;
    let vx = Math.cos(angle) * SPEED;
    let vy = Math.sin(angle) * SPEED;
    let rot = 0;
    let raf: number;

    function tick() {
      x += vx;
      y += vy;
      rot += (vx > 0 ? 1 : -1) * 2.5;

      const maxX = window.innerWidth - SIZE;
      const maxY = window.innerHeight - SIZE;

      if (x <= 0)    { x = 0;    vx =  Math.abs(vx); }
      if (x >= maxX) { x = maxX; vx = -Math.abs(vx); }
      if (y <= 0)    { y = 0;    vy =  Math.abs(vy); }
      if (y >= maxY) { y = maxY; vy = -Math.abs(vy); }

      el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: SIZE,
        height: SIZE,
        zIndex: 40,
        pointerEvents: 'none',
        willChange: 'transform',
        opacity: 0.75,
      }}
    >
      <svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
        <circle cx="26" cy="26" r="25" fill="#c9e219" />
        <circle cx="26" cy="26" r="25" fill="none" stroke="#afc912" strokeWidth="1" />
        {/* Seam — two S-curves that wrap around the ball */}
        <path d="M8,14 C16,20 16,32 8,38"   stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M44,14 C36,20 36,32 44,38"  stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M8,14 C16,6 36,6 44,14"    stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M8,38 C16,46 36,46 44,38"  stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
