import { reviewHistoryRoute } from "@/lib/data-hub/analysisExecution/reviewHistoryRoute";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return reviewHistoryRoute(request, params, "detail");
}
