import { HlnaAssistantWrapper } from "../../components/brand/HlnaAssistantWrapper";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <HlnaAssistantWrapper />
    </>
  );
}
