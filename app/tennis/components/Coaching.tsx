import ScrollFadeIn from "./ScrollFadeIn";

const services = [
  { name: "Private Coaching", tag: "Most popular", pricing: [{ label: "1 hour", value: "$70" }, { label: "30 min", value: "$35" }], description: "One-on-one sessions built entirely around you — the fastest way to improve at any age or level.", featured: true },
  { name: "ANZ Hot Shots", tag: "Ages 5–12", pricing: [{ label: "Per term (min. 8 wks)", value: "$140" }, { label: "Casual", value: "$20" }], description: "Red, Orange, and Green ball groups for junior players. Builds coordination, agility, and confidence on smaller courts with modified equipment.", featured: false },
  { name: "Yellow Ball Squads", tag: "Intermediate", pricing: [{ label: "Per term (min. 8 wks)", value: "$140" }, { label: "Casual", value: "$20" }], description: "Squad sessions for players developing match play skills and on-court decision making. One hour per session.", featured: false },
  { name: "Cardio Tennis", tag: "All levels", pricing: [{ label: "Per session", value: "$15" }, { label: "Per term (10 sessions)", value: "$120" }], description: "A high-energy group fitness class combining tennis drills, games, and a pumping soundtrack. Social, fun, and suitable for all abilities.", featured: false },
  { name: "Semi-Private Coaching", tag: "2–4 players", pricing: [{ label: "Varies by group size", value: "Ask Luke" }], description: "Train with friends or family in a small group. More flexible than private coaching, still highly focused.", featured: false },
];

export default function Coaching() {
  return (
    <section id="coaching" className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10">
          <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Coaching</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">What&apos;s Available</h2>
        </ScrollFadeIn>
        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 group relative rounded-2xl border border-green-500/25 bg-linear-to-br from-green-500/10 via-green-500/5 to-transparent p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6 shadow-lg shadow-black/40 hover:-translate-y-1.5 hover:shadow-[0_20px_60px_rgba(34,197,94,0.15)] hover:border-green-500/40 hover:from-green-500/15 transition-all duration-300 cursor-pointer overflow-hidden">
              <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-green-500/10 blur-3xl pointer-events-none group-hover:bg-green-500/15 transition-all duration-500" />
              <div className="flex flex-col gap-3 flex-1 relative">
                <span className="inline-flex items-center gap-1.5 w-fit text-xs font-semibold uppercase tracking-widest text-green-400 bg-green-500/15 border border-green-500/30 rounded-full px-3 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{services[0].tag}
                </span>
                <h3 className="text-2xl font-bold text-white tracking-tight">{services[0].name}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed max-w-lg group-hover:text-zinc-300 transition-colors duration-300">{services[0].description}</p>
              </div>
              <div className="flex gap-3 shrink-0 relative">
                {services[0].pricing.map((p) => (
                  <div key={p.label} className="bg-black/40 border border-white/12 rounded-xl px-5 py-3.5 text-center min-w-24 group-hover:border-white/20 group-hover:bg-black/50 transition-all duration-300">
                    <p className="text-2xl font-bold text-white">{p.value}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{p.label}</p>
                  </div>
                ))}
              </div>
            </div>
            {services.slice(1).map((service) => (
              <div key={service.name} className="group relative rounded-2xl border border-white/8 bg-white/4 p-7 flex flex-col justify-between gap-5 shadow-md shadow-black/30 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/50 hover:bg-white/7 hover:border-white/15 transition-all duration-300 cursor-pointer overflow-hidden">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/0 group-hover:bg-white/4 blur-2xl pointer-events-none transition-all duration-500" />
                <div className="flex flex-col gap-3 relative">
                  <span className="inline-flex w-fit text-xs font-semibold uppercase tracking-widest text-zinc-500 bg-white/6 border border-white/10 rounded-full px-3 py-1 group-hover:text-zinc-400 group-hover:border-white/15 transition-colors duration-300">{service.tag}</span>
                  <h3 className="text-lg font-bold text-zinc-100 tracking-tight group-hover:text-white transition-colors duration-300">{service.name}</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed group-hover:text-zinc-400 transition-colors duration-300">{service.description}</p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-4 border-t border-white/6 group-hover:border-white/10 transition-colors duration-300 relative">
                  {service.pricing.map((p) => (
                    <div key={p.label} className="flex items-baseline gap-1.5">
                      <span className="text-base font-bold text-zinc-200 group-hover:text-white transition-colors duration-300">{p.value}</span>
                      <span className="text-xs text-zinc-600">{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollFadeIn>
        <ScrollFadeIn delay={200}>
          <p className="mt-8 text-zinc-500 text-sm leading-relaxed">
            Not sure where to start?{" "}
            <a href="#contact" className="text-zinc-300 hover:text-white underline underline-offset-4 transition-colors">Just send a message</a>{" "}
            and we&apos;ll figure it out.
          </p>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
