import { PlatformOnly } from "@/components/role-guard";

export default function AllBranchesLayout({ children }: { children: React.ReactNode }) {
  return <PlatformOnly>{children}</PlatformOnly>;
}
