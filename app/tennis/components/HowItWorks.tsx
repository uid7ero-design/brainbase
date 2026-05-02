import ScrollFadeIn from "./ScrollFadeIn";

const steps = [
  { number: "01", title: "Reach Out", description: "Send a quick message to get started — no pressure, just a conversation." },
  { number: "02", title: "Find Your Fit", description: "We'll match you to the right session based on your level and goals." },
  { number: "03", title: "Start Training", description: "Start structured coaching with clear progress from day one." },
];

export default function HowItWorks() {
  return (
    <section className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10">
          <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Process</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">How It Works</h2>
        </ScrollFadeIn>
        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((step, i) => (
              <div key={step.number} className="group relative rounded-2xl border border-white/8 bg-white/4 p-7 flex flex-col gap-5 shadow-md shadow-black/30 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/50 hover:bg-white/7 hover:border-white/15 transition-all duration-300 overflow-hidden">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/0 group-hover:bg-green-500/6 blur-2xl pointer-events-none transition-all duration-500" />
                <div className="flex items-center justify-between relative">
                  <span className="text-5xl font-bold text-white/15 tabular-nums select-none leading-none group-hover:text-white/25 transition-colors duration-300">{step.number}</span>
                  {i < steps.length - 1 && (
                    <svg className="hidden md:block w-4 h-4 text-white/15 absolute -right-6 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  )}
                </div>
                <div className="flex flex-col gap-2 relative">
                  <h3 className="text-lg font-bold text-white leading-snug">{step.title}</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed group-hover:text-zinc-400 transition-colors duration-300">{step.description}</p>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-green-500/0 via-green-500/40 to-green-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
            ))}
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
