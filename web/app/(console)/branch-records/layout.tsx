import { BranchOnly } from "@/components/role-guard";

/**
 * Branch Records is the branch's own housekeeping: its bank details, its
 * chairman and the signature printed on its certificates. A super
 * administrator has no branch, so this route is refused rather than rendered
 * against whichever branch they happened to be attached to.
 */
export default function BranchRecordsLayout({ children }: { children: React.ReactNode }) {
  return <BranchOnly>{children}</BranchOnly>;
}
