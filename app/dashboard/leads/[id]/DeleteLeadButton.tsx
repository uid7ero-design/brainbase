"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    router.push("/dashboard/leads");
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-400">Delete this lead?</span>
        <button onClick={handleDelete} disabled={deleting} className="text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50">
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
        <button onClick={() => setConfirm(false)} className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirm(true)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors font-medium">
      Delete lead
    </button>
  );
}
