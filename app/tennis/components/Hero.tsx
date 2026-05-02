import Image from "next/image";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden bg-[#0a0a0a] px-6">
      <div className="absolute inset-0 pointer-events-none select-none">
        <div className="absolute top-1/2 right-0 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-500/[0.07] blur-[160px]" />
        <div className="absolute top-1/2 left-1/3 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-green-500/[0.05] blur-[120px]" />
      </div>
      <div className="absolute inset-0 pointer-events-none select-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "64px 64px", maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)" }} />
      <div className="relative z-10 max-w-5xl mx-auto w-full pt-24 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="flex flex-col gap-7 text-center lg:text-left items-center lg:items-start order-2 lg:order-1">
            <div className="animate-fade-in [animation-delay:100ms] inline-flex items-center gap-2.5 bg-green-500/10 border border-green-500/30 rounded-full px-4 py-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-400 text-sm font-medium tracking-wide">Accepting New Students</span>
            </div>
            <h1 className="animate-fade-up [animation-delay:200ms] text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-white leading-[1.06]">
              Private Tennis Coaching That Builds{" "}
              <span className="text-green-500">Real Confidence</span>
            </h1>
            <p className="animate-fade-up [animation-delay:350ms] text-lg text-zinc-400 max-w-lg leading-relaxed">
              Beginner-friendly coaching for kids and adults. Learn the game properly from the start, with clear structure and real progress.
            </p>
            <div className="animate-fade-up [animation-delay:500ms] flex flex-col sm:flex-row gap-4 items-center lg:items-start">
              <a href="#contact" className="group inline-flex items-center gap-2 bg-green-500 text-black font-semibold px-7 py-3.5 rounded-full hover:bg-green-400 active:scale-95 transition-all duration-200 text-base shadow-[0_0_40px_rgba(34,197,94,0.25)] hover:shadow-[0_0_60px_rgba(34,197,94,0.45)]">
                Contact Me
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </a>
              <a href="#coaching" className="text-zinc-400 hover:text-white text-sm font-medium transition-colors underline-offset-4 hover:underline">See coaching options</a>
            </div>
            <div className="animate-fade-in [animation-delay:700ms] flex items-center gap-8 pt-6 border-t border-white/8 w-full justify-center lg:justify-start">
              {[{ value: "10+", label: "Years Experience" }, { value: "100+", label: "Students Coached" }, { value: "Level 1", label: "Certified Coach" }].map((stat) => (
                <div key={stat.label} className="text-center lg:text-left">
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 tracking-wide uppercase">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-center lg:justify-end order-1 lg:order-2 animate-fade-in [animation-delay:300ms]">
            <div className="relative">
              <div className="absolute -inset-3 rounded-3xl bg-linear-to-b from-green-500/20 to-green-500/5 blur-xl opacity-70" />
              <div className="absolute -inset-0.5 rounded-3xl bg-linear-to-br from-green-500/40 via-green-500/10 to-transparent" />
              <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-black/60 w-[300px] h-[360px] sm:w-[360px] sm:h-[430px] lg:w-[400px] lg:h-[480px]">
                <Image src="/luke.png" alt="Luke Doughty – Head Coach, LD Tennis" fill className="object-cover object-top" priority sizes="(max-width: 640px) 300px, (max-width: 1024px) 360px, 400px" />
                <div className="absolute bottom-0 inset-x-0 h-24 bg-linear-to-t from-[#0a0a0a]/60 to-transparent" />
              </div>
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-[#111]/90 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-xl whitespace-nowrap">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                <div>
                  <div className="text-white text-sm font-semibold leading-tight">Luke Doughty</div>
                  <div className="text-zinc-500 text-xs">Head Coach · Level 1 Certified</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-40">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
    </section>
  );
}
