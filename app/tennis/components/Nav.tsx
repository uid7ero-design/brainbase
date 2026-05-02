"use client";
import { useState, useEffect } from "react";
import Image from "next/image";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? "bg-black/90 backdrop-blur-xl border-b border-white/8" : "bg-transparent"}`}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-5 flex items-center justify-between">
        <a href="/tennis" className="group flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-white/15 shadow-md shadow-black/40 group-hover:border-white/30 transition-all duration-300">
            <Image src="/logo.jpg" alt="LD Tennis" fill className="object-cover" sizes="40px" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white hidden sm:block">
            LD <span className="text-green-500">Tennis</span>
          </span>
        </a>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
            <a href="#coaching" className="hover:text-white transition-colors">Coaching</a>
            <a href="#about" className="hover:text-white transition-colors">About</a>
          </div>
          <a href="#contact" className="text-sm font-semibold bg-green-500 text-black px-5 py-2.5 rounded-full hover:bg-green-400 active:scale-95 transition-all duration-200">
            Contact Me
          </a>
        </div>
      </div>
    </nav>
  );
}
