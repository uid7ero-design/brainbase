import ScrollFadeIn from "./ScrollFadeIn";

export default function Location() {
  return (
    <section className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10">
          <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Location</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">Where You&apos;ll Train</h2>
          <p className="text-zinc-500 mt-4 text-base max-w-sm">Convenient south locations with flexible session times.</p>
        </ScrollFadeIn>
        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="group relative rounded-2xl border border-white/8 bg-white/4 p-7 flex flex-col gap-6 shadow-md shadow-black/30 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/50 hover:bg-white/7 hover:border-white/15 transition-all duration-300 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/0 group-hover:bg-green-500/6 blur-2xl pointer-events-none transition-all duration-500" />
              <div className="flex items-center gap-3 relative">
                <div className="w-9 h-9 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/10 group-hover:border-white/15 transition-all duration-300">
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 transition-colors duration-300">Courts</p>
              </div>
              <ul className="flex flex-col gap-5 relative">
                <li><p className="text-white font-semibold">Mt Compass Tennis Club</p><p className="text-zinc-500 text-sm mt-0.5">Southern Adelaide</p></li>
                <li><p className="text-white font-semibold">Morphett Vale Tennis Club</p><p className="text-zinc-500 text-sm mt-0.5">Southern Adelaide · TBC</p></li>
              </ul>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-green-500/0 via-green-500/40 to-green-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div className="group relative rounded-2xl border border-white/8 bg-white/4 p-7 flex flex-col gap-6 shadow-md shadow-black/30 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/50 hover:bg-white/7 hover:border-white/15 transition-all duration-300 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/0 group-hover:bg-green-500/6 blur-2xl pointer-events-none transition-all duration-500" />
              <div className="flex items-center gap-3 relative">
                <div className="w-9 h-9 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/10 group-hover:border-white/15 transition-all duration-300">
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 transition-colors duration-300">Availability</p>
              </div>
              <ul className="flex flex-col gap-5 relative">
                <li><p className="text-white font-semibold">Monday to Friday</p><p className="text-zinc-500 text-sm mt-0.5">From 3:30pm onwards</p></li>
                <li><p className="text-zinc-400 text-sm leading-relaxed group-hover:text-zinc-300 transition-colors duration-300">Flexible times available — <a href="#contact" className="text-zinc-300 hover:text-white underline underline-offset-4 transition-colors">reach out to discuss</a>.</p></li>
              </ul>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-green-500/0 via-green-500/40 to-green-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
