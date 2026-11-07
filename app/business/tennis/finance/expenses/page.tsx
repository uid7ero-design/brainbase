import ReceiptExpenses, { type ReceiptPageProps } from '@/app/commercial/_components/ReceiptExpenses';

export default function Page(props: ReceiptPageProps) {
  return <ReceiptExpenses workspace="tennis" {...props} />;
}
