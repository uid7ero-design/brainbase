import { HlnaAssistantWrapper } from "../../components/brand/HlnaAssistantWrapper";
import { TrialBanner } from "@/components/TrialBanner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TrialBanner />
      {children}
      <HlnaAssistantWrapper />
    </>
  );
}
