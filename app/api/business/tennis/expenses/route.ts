import { recordReceipt } from '@/lib/commercial/recordReceipt';

export function POST(request: Request) {
  return recordReceipt(request, 'tennis');
}
