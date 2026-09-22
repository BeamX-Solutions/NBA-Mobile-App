import { PlatformOnly } from "@/components/role-guard";

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return <PlatformOnly>{children}</PlatformOnly>;
}
