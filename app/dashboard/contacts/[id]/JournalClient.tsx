"use client";

import { useState, useRef } from "react";

type Entry = { id: string; note: string; created_at: string };

function formatEntry(ts: string) {
  const d = new Date(ts);
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} · ${d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function JournalClient({ contactId, initial }: { contactId: string; initial: Entry[] }) {
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/contacts/${contactId}/journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (res.ok) {
      const { entry } = await res.json();
      setEntries(prev => [entry, ...prev]);
      setNote("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
    setSaving(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setNote(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  return (
    <div>
      {/* Add entry */}
      <form onSubmit={handleSubmit} className="mb-8">
        <textarea
          ref={textareaRef}
          value={note}
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          placeholder="Add a session note…"
          rows={3}
          className="w-full bg-white/4 border border-white/8 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:border-white/16 focus:bg-white/6 transition-all duration-200 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-zinc-600 text-xs">⌘ + Enter to save</span>
          <button
            type="submit"
            disabled={saving || !note.trim()}
            className="text-sm font-semibold bg-green-500 text-black px-5 py-2 rounded-full hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Add Entry"}
          </button>
        </div>
      </form>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-zinc-600 text-sm">No session notes yet. Add your first note above.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map(entry => (
            <div key={entry.id} className="border-l-2 border-white/8 pl-5 py-1">
              <p className="text-xs text-zinc-600 mb-2 font-medium">{formatEntry(entry.created_at)}</p>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
