import Link from 'next/link';
import styles from '../../workspace.module.css';

export type PreviousClass = { id: string; day: string; note: string };

export default function PreviousClassHandover({ previous }: { previous: PreviousClass }) {
  return <section aria-label="Previous class handover" className={styles.panel}>
    <h2>Previous class handover</h2>
    <Link href={'/coaching/roster/' + encodeURIComponent(previous.id)}>{previous.day} class roster</Link>
    <p className={styles.handoverNote}>{previous.note}</p>
  </section>;
}
