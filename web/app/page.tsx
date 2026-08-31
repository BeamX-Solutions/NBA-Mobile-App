import { redirect } from "next/navigation";

/**
 * The console has no marketing home. An administrator lands on the queue,
 * and the guard in (console)/layout.tsx sends them to sign in if they are not
 * already. The public verification page is reached by QR code or by link, not
 * from here.
 */
export default function Home() {
  redirect("/dashboard");
}
