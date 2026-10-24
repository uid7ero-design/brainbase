"use client";

import Link from "next/link";
import { useState } from "react";
import { BLOCKER_COPY, createRunsPilotReview, evaluateRunsPilotReview, fieldReviewComplete,
  REPRESENTATION_LABELS, RUNS_REVIEW_FIELDS, UNIT_LABELS,
  type FieldReview, type Representation, type ReviewUnit, type RunsPilotReview } from "@/lib/data-hub/schemaProfiles/runsPilotReview";
import { Button } from "@/components/ui/Button";
import styles from "./runsReview.module.css";

export default function RunsPilotReviewClient({ initialReview, onSave, readOnly = false, embedded = false }: {
  initialReview?: RunsPilotReview; onSave?: (review: RunsPilotReview) => void; readOnly?: boolean; embedded?: boolean;
} = {}) {
  const [review, setReview] = useState(() => initialReview ?? createRunsPilotReview());
  const result = evaluateRunsPilotReview(review);
  if (!result.ok) return <p role="alert">Couldn’t validate this draft. Reload the page to start again.</p>;
  function change(index: number, patch: Partial<FieldReview>) {
    setReview(previous => ({ ...previous, fields: previous.fields.map((field, i) =>
      i === index ? { ...field, ...patch, confirmed: false } : field) }));
  }
  const download = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.review, null, 2))}`;

  const Container = embedded ? "section" : "main", Heading = embedded ? "h2" : "h1";
  return <Container className={styles.page}>
    {!embedded ? <>
    <Link href="/data-hub/sources">Back to source configuration</Link>
    </> : null}
    <Heading>Review Runs field meanings</Heading>
    {!embedded ? <>
    <p>Onkaparinga Runs template. This does not load a workbook or your organisation’s saved settings.</p>
    </> : <p>Review every field’s format and unit. Saving creates an approved mapping version for future workbooks; it does not prepare this workbook.</p>}
    <p>{readOnly && embedded ? "These are the approved choices. Check that this workbook uses the same units and formats before confirming it." : "Confirm how your report records each field. The suggestions below are starting points; none are confirmed for you."}</p>
    {!(readOnly && embedded) ? <>
    <p>Tonnes are suggested for total weight, days for overall duration, and hours for truck working time.
      Average bin weight and distance units still need a choice.</p>
    </> : null}
    {!embedded ? <p>This review collects a draft. Download it to keep your choices; leaving this page loses unsaved changes.
      An administrator still needs to review and activate the mapping before it can prepare data.</p> : null}
    <section className={styles.notice} aria-labelledby="missing-heading">
      <h2 id="missing-heading">Zero and missing values</h2>
      <p>Zero stays a value. An absent cell stays missing. Empty text, “N/A” and dashes are not automatically treated as missing.
        Invalid numeric or date text blocks preparation.</p>
      <label htmlFor="missing-policy">How does your report mark missing values?</label>
      <select id="missing-policy" disabled={readOnly} value={review.missingPolicy ?? ""} onChange={event => setReview(previous => ({
        ...previous, missingPolicy: (event.target.value || null) as typeof previous.missingPolicy }))}>
        <option value="">Choose…</option>
        <option value="NULL_ONLY">Only absent cells; keep other text exactly as supplied</option>
        <option value="ADDITIONAL_MARKERS">It also uses N/A, dashes or other markers — needs review</option>
      </select>
    </section>
    <p role="status" aria-live="polite">{result.confirmedCount} of 21 fields confirmed.
      {result.reviewComplete ? readOnly && embedded ? " Saved field review." : " Field review complete; activation still requires review." : " Confirm every field and the missing-value convention."}</p>
    <div className={styles.fields}>
      {RUNS_REVIEW_FIELDS.map((spec, index) => {
        const field = review.fields[index], prefix = `runs-${index}`;
        return <fieldset key={spec.id} className={styles.field} disabled={readOnly}>
          <legend>{index + 1}. {spec.header}</legend>
          {spec.sensitivity === "PERSONALLY_IDENTIFIABLE" ? <p>Personal information: keep existing access restrictions.</p> : null}
          <label htmlFor={`${prefix}-representation`}>How is {spec.header} recorded?</label>
          <select id={`${prefix}-representation`} value={field.representation ?? ""} onChange={event => change(index, {
            representation: (event.target.value || null) as Representation | null, negativePolicy: null })}>
            <option value="">Choose…</option>
            {spec.representations.map(value => <option key={value} value={value}>{REPRESENTATION_LABELS[value]}</option>)}
          </select>
          <label htmlFor={`${prefix}-unit`}>Unit for {spec.header}</label>
          <select id={`${prefix}-unit`} value={field.unit ?? ""} onChange={event => change(index, { unit: (event.target.value || null) as ReviewUnit | null })}>
            <option value="">Choose…</option>
            {spec.units.map(value => <option key={value} value={value}>{UNIT_LABELS[value]}</option>)}
          </select>
          {field.representation === "WHOLE_NUMBER" ? <>
            <label htmlFor={`${prefix}-negative`}>Are negative values valid for {spec.header}?</label>
            <select id={`${prefix}-negative`} value={field.negativePolicy ?? ""} onChange={event => change(index, {
              negativePolicy: (event.target.value || null) as FieldReview["negativePolicy"] })}>
              <option value="">Choose…</option><option value="ALLOW">Yes, signed counts are valid</option>
              <option value="FORBID">No, negatives must be rejected</option>
            </select>
          </> : null}
          <label className={styles.confirm}>
            <input type="checkbox" checked={field.confirmed} disabled={!fieldReviewComplete(field)} onChange={event => {
              const confirmed = event.target.checked;
              setReview(previous => ({ ...previous, fields: previous.fields.map((item, i) => i === index ? { ...item, confirmed } : item) }));
            }} /> I confirm the meaning and unit for {spec.header}
          </label>
          {result.blockers.filter(b => b.fieldKey === spec.id).map(b => <p key={b.code}>{BLOCKER_COPY[b.code]}</p>)}
        </fieldset>;
      })}
    </div>
    <section className={styles.notice} aria-labelledby="next-heading">
      <h2 id="next-heading">Keep your review</h2>
      {onSave ? <Button type="button" variant="primary" disabled={readOnly || !result.reviewComplete || result.blockers.length > 0}
        onClick={() => onSave(result.review)}>Save and activate reviewed mapping</Button> : null}
      {result.blockers.length ? <p>Some choices need additional mapping support. They will be included in the review; downloading does not enable preparation.</p> : null}
      {result.blockers.filter(b => !b.fieldKey).map(b => <p key={b.code}>{BLOCKER_COPY[b.code]}</p>)}
      <a href={download} download="runs-field-review.json">Download draft field review</a>
      <p>The download contains field choices only. It does not read report values, change the active mapping or start preparation.</p>
    </section>
  </Container>;
}
