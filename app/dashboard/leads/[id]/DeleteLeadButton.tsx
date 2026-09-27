"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonProps } from "@/components/ui/app";
import styles from "../Leads.module.css";

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
      <div className={styles.confirm} role="group" aria-label="Confirm delete">
        <span>Delete this lead?</span>
        <button type="button" onClick={handleDelete} disabled={deleting} {...buttonProps("danger", "sm")}>
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" onClick={() => setConfirm(false)} {...buttonProps("ghost", "sm")}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setConfirm(true)} {...buttonProps("ghost", "sm")}>
      Delete lead
    </button>
  );
}
