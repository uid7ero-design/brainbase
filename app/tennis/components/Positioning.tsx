import ScrollFadeIn from "./ScrollFadeIn";

const points = [
  { number: "01", title: "Fundamentals first.", body: "Every session is built around the foundations of the game — technique, movement, and awareness. Skills developed properly from the start last." },
  { number: "02", title: "Tailored to the individual.", body: "No generic programs. Each session is structured around your level, goals, and pace." },
  { number: "03", title: "Confidence is the outcome.", body: "Progress isn't just technical — it's how you feel on court. Relaxed, capable, and ready to play." },
  { number: "04", title: "Beginner-first approach.", body: "From first-time players to adults returning to the game, every session is structured, supportive, and easy to follow." },
];

export default function Positioning() {
  return (
    <section className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10">
          <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Philosophy</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">A Better Way to Learn Tennis</h2>
        </ScrollFadeIn>
        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {points.map((point) => (
              <div key={point.number} className="group relative rounded-2xl border border-white/8 bg-white/4 p-7 flex flex-col gap-4 shadow-md shadow-black/30 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/50 hover:bg-white/7 hover:border-white/15 transition-all duration-300 overflow-hidden">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/0 group-hover:bg-green-500/6 blur-2xl pointer-events-none transition-all duration-500" />
                <span className="text-5xl font-bold text-white/10 tabular-nums select-none leading-none group-hover:text-white/15 transition-colors duration-300">{point.number}</span>
                <div className="flex flex-col gap-2 relative">
                  <h3 className="text-lg font-bold text-white leading-snug">{point.title}</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed group-hover:text-zinc-400 transition-colors duration-300">{point.body}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
