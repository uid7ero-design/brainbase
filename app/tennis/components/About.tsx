import Image from "next/image";
import ScrollFadeIn from "./ScrollFadeIn";

const highlights = ["20+ Years in Tennis", "Tennis Australia Certified", "Level 1 Coach", "Division 1 Player", "All Ages 5+"];

export default function About() {
  return (
    <section id="about" className="py-28 md:py-36 px-6 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-14 lg:gap-24 items-center">
          <ScrollFadeIn>
            <div className="relative max-w-lg mx-auto lg:mx-0">
              <div className="absolute -inset-4 rounded-3xl bg-green-500/8 blur-3xl" />
              <div className="absolute -inset-0.5 rounded-3xl bg-linear-to-br from-green-500/30 via-green-500/8 to-transparent" />
              <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-black/60 w-full aspect-[3/4]">
                <Image src="/luke.png" alt="Luke Doughty – Head Coach, LD Tennis" fill className="object-cover object-top" sizes="(max-width: 1024px) 100vw, 50vw" />
                <div className="absolute bottom-0 inset-x-0 h-40 bg-linear-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 flex flex-wrap gap-2">
                  {highlights.map((h) => (
                    <span key={h} className="text-xs font-medium text-white/85 bg-black/55 backdrop-blur-sm border border-white/15 rounded-full px-3 py-1.5">{h}</span>
                  ))}
                </div>
              </div>
            </div>
          </ScrollFadeIn>

          <ScrollFadeIn delay={120}>
            <div className="flex flex-col gap-8">
              <div>
                <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-4">Meet your coach</p>
                <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-none">Luke Doughty</h2>
                <div className="h-px w-12 bg-white/15 mt-6 mb-5" />
                <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest">Head Coach &amp; Founder</p>
              </div>

              <div className="space-y-5 text-zinc-400 leading-relaxed text-base">
                <p>Luke has been involved in tennis for over 20 years and brings 5 years of coaching experience to his programs. A current Level 1 certified coach with Tennis Australia, he has worked with leading sporting organisations including the South Australian Cricket Association and Tennis SA — where he developed a deep understanding of how important the right entry-level coaching is in shaping a player&apos;s long-term experience.</p>
                <p>After working full-time with Tennis SA, Luke stepped away to return to hands-on coaching with a focus on growing the game at a grassroots level. As a current Division 1 men&apos;s player, he combines his playing experience with a structured, supportive approach — delivering sessions that are clear, engaging, and tailored to each individual.</p>
                <p>Specialising in beginner and entry-level coaching for ages 5+, his goal is simple: to create a positive environment where players learn the game properly, enjoy the process, and develop confidence that lasts.</p>
              </div>

              <div className="pt-1">
                <a href="#contact" className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors group">
                  Contact Luke
                  <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </a>
              </div>
            </div>
          </ScrollFadeIn>
        </div>
      </div>
    </section>
  );
}
