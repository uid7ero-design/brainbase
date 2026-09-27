"use client";

import { useState, useRef } from "react";
import { buttonProps, fieldControlClassName } from "@/components/ui/app";
import styles from "../Contacts.module.css";

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
      <form onSubmit={handleSubmit} className={styles.journalForm}>
        <textarea
          aria-label="Session note"
          aria-describedby="journal-hint"
          ref={textareaRef}
          value={note}
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          placeholder="Add a session note…"
          rows={3}
          className={`${fieldControlClassName} ${styles.journalTextarea}`}
        />
        <div className={styles.journalFooter}>
          <span id="journal-hint" className={styles.hint}>⌘ + Enter to save</span>
          <button
            type="submit"
            disabled={saving || !note.trim()}
            {...buttonProps('primary')}
          >
            {saving ? "Saving…" : "Add Entry"}
          </button>
        </div>
      </form>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className={styles.empty}>No session notes yet. Add your first note above.</p>
      ) : (
        <ul className={styles.entries}>
          {entries.map(entry => (
            <li key={entry.id} className={styles.entry}>
              <p className={styles.entryDate}>{formatEntry(entry.created_at)}</p>
              <p className={styles.entryNote}>{entry.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
