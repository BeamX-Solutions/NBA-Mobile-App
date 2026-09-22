import { BranchOnly } from "@/components/role-guard";

/**
 * The verification queue. issue_rbin refuses a super administrator in the
 * database, so without this the screen would render a queue whose approve
 * button could only ever fail.
 */
export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return <BranchOnly>{children}</BranchOnly>;
}
