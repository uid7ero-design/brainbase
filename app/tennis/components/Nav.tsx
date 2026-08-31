"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  // Below the md breakpoint, every link in the row below (Coaching,
  // About, Blog, Events) previously sat inside a bare `hidden md:flex`
  // wrapper with no fallback at all — on a phone-width viewport none of
  // them were reachable, Events included. This toggle adds the missing
  // fallback: the same links, in a simple dropdown panel.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled || mobileOpen ? "bg-black/90 backdrop-blur-xl border-b border-white/8" : "bg-transparent"}`}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-5 flex items-center justify-between">
        <a href="/tennis" className="group hover:opacity-90 transition-opacity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ld-tennis-logo.svg" alt="LD Tennis Coaching" className="h-10 w-auto" />
        </a>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
            <a href="#coaching" className="hover:text-white transition-colors">Coaching</a>
            <a href="#about" className="hover:text-white transition-colors">About</a>
            <Link href="/tennis/blog" className="hover:text-white transition-colors">Blog</Link>
            <Link href="/e/ld-tennis" className="hover:text-white transition-colors">Events</Link>
          </div>
          <div className="flex items-center gap-3">
            <a href="/tennis/book" className="hidden md:block text-sm font-semibold text-green-400 hover:text-green-300 transition-colors">
              Book a Session
            </a>
            <a href="#contact" className="text-sm font-semibold bg-green-500 text-black px-5 py-2.5 rounded-full hover:bg-green-400 active:scale-95 transition-all duration-200">
              Contact Me
            </a>
          </div>
          <a href="/login" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors hidden md:block">
            Login
          </a>
          <button
            type="button"
            className="md:hidden flex flex-col items-center justify-center gap-1.5 w-9 h-9 -mr-1"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(v => !v)}
          >
            <span className={`block h-0.5 w-5 bg-white transition-transform duration-200 ${mobileOpen ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block h-0.5 w-5 bg-white transition-opacity duration-200 ${mobileOpen ? "opacity-0" : "opacity-100"}`} />
            <span className={`block h-0.5 w-5 bg-white transition-transform duration-200 ${mobileOpen ? "-translate-y-2 -rotate-45" : ""}`} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-white/8 bg-black/95 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-1 text-sm">
            <a href="#coaching" className="text-zinc-300 hover:text-white transition-colors py-2.5" onClick={() => setMobileOpen(false)}>Coaching</a>
            <a href="#about" className="text-zinc-300 hover:text-white transition-colors py-2.5" onClick={() => setMobileOpen(false)}>About</a>
            <Link href="/tennis/blog" className="text-zinc-300 hover:text-white transition-colors py-2.5" onClick={() => setMobileOpen(false)}>Blog</Link>
            <Link href="/e/ld-tennis" className="text-zinc-300 hover:text-white transition-colors py-2.5" onClick={() => setMobileOpen(false)}>Events</Link>
            <a href="/tennis/book" className="text-green-400 hover:text-green-300 font-semibold transition-colors py-2.5" onClick={() => setMobileOpen(false)}>Book a Session</a>
            <a href="/login" className="text-zinc-500 hover:text-zinc-300 transition-colors py-2.5" onClick={() => setMobileOpen(false)}>Login</a>
          </div>
        </div>
      )}
    </nav>
  );
}
