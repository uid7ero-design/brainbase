"use client";

import { useState } from "react";
import type { BookingRequest, BookingResponse } from "@/app/tennis/lib/booking";
import ScrollFadeIn from "./ScrollFadeIn";

type FormState = "idle" | "loading" | "success" | "error";

const inputClass = "w-full bg-white/4 border border-white/8 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:border-green-500/40 focus:bg-white/6 transition-all duration-200";
const labelClass = "block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2";

const directLinks = [
  { label: "Email", value: "lukedoughtytennis@outlook.com", href: "mailto:lukedoughtytennis@outlook.com", external: false },
  { label: "Phone", value: "0413 091 027", href: "tel:+61413091027", external: false },
  { label: "WhatsApp", value: "Message on WhatsApp", href: "https://wa.me/61413091027", external: true },
  { label: "Facebook", value: "LD Tennis Coaching", href: "https://www.facebook.com/profile.php?id=61582192363700", external: true },
];

export default function BookingForm() {
  const [form, setForm] = useState<BookingRequest>({ name: "", email: "", phone: "", sessionType: "", message: "" });
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMessage("");
    try {
      const res = await fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      let data: BookingResponse;
      try { data = await res.json(); } catch { setState("error"); setErrorMessage(`Server error (${res.status}). Please try again.`); return; }
      if (data.success) { setState("success"); } else { setState("error"); setErrorMessage(data.message); }
    } catch (err) {
      console.error("[BookingForm] fetch error:", err);
      setState("error");
      setErrorMessage("Could not reach the server. Please try again.");
    }
  }

  return (
    <section id="contact" className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10">
          <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Contact</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">Get in Touch</h2>
          <p className="text-zinc-500 mt-4 text-base max-w-sm">Send a message and Luke will get back to you to organise a time.</p>
        </ScrollFadeIn>
        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 lg:gap-16 items-start">
            <div>
              {state === "success" ? (
                <div className="border border-green-500/20 bg-green-500/5 rounded-2xl p-10 flex flex-col items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Message sent</h3>
                    <p className="text-zinc-400 text-sm mt-1 leading-relaxed">Luke will be in touch to confirm your session.</p>
                  </div>
                  <button onClick={() => { setState("idle"); setForm({ name: "", email: "", phone: "", sessionType: "", message: "" }); }} className="text-sm text-zinc-400 hover:text-white transition-colors underline-offset-4 hover:underline mt-1">
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="name" className={labelClass}>Full Name <span className="text-green-500 normal-case font-normal">*</span></label>
                      <input id="name" name="name" type="text" required placeholder="Your name" value={form.name} onChange={handleChange} className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="email" className={labelClass}>Email <span className="text-green-500 normal-case font-normal">*</span></label>
                      <input id="email" name="email" type="email" required placeholder="you@example.com" value={form.email} onChange={handleChange} className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="phone" className={labelClass}>Phone <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
                    <input id="phone" name="phone" type="tel" placeholder="0400 000 000" value={form.phone} onChange={handleChange} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="sessionType" className={labelClass}>Session Type <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
                    <input id="sessionType" name="sessionType" type="text" placeholder="e.g. Private lesson, Hot Shots, Cardio Tennis" value={form.sessionType ?? ""} onChange={handleChange} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="message" className={labelClass}>Message <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
                    <textarea id="message" name="message" rows={4} placeholder="Tell Luke about yourself and what you'd like to work on..." value={form.message} onChange={handleChange} className={`${inputClass} resize-none`} />
                  </div>
                  {state === "error" && (
                    <p className="text-red-400 text-sm bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-3">{errorMessage}</p>
                  )}
                  <button type="submit" disabled={state === "loading"} className="inline-flex items-center justify-center gap-2 bg-green-500 text-black font-semibold px-8 py-3.5 rounded-full hover:bg-green-400 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 text-sm shadow-[0_0_30px_rgba(34,197,94,0.2)] hover:shadow-[0_0_40px_rgba(34,197,94,0.35)] self-start">
                    {state === "loading" ? (
                      <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Sending…</>
                    ) : (
                      <>Send Message<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg></>
                    )}
                  </button>
                  <p className="text-zinc-600 text-xs">No payment required — Luke will confirm your session directly.</p>
                </form>
              )}
            </div>
            <div className="lg:pt-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-6">Or reach out directly</p>
              <div>
                {directLinks.map((link, i) => (
                  <a key={link.label} href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noopener noreferrer" : undefined} className={`group flex items-baseline justify-between py-4 border-t border-white/5 hover:border-white/10 transition-colors duration-200 ${i === directLinks.length - 1 ? "border-b border-white/5" : ""}`}>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-0.5">{link.label}</p>
                      <p className="text-sm text-zinc-300 group-hover:text-white transition-colors duration-200">{link.value}</p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-200 shrink-0 ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                  </a>
                ))}
              </div>
              <p className="text-zinc-600 text-xs mt-6 leading-relaxed">Based in Southern Adelaide · Sessions at local courts</p>
            </div>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
