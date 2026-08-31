"use client";

import { AuthProvider } from "@/lib/auth";

/**
 * Client boundary for the root layout.
 *
 * Children are passed through as a prop, so server components below this stay
 * server components. The public verification page in particular must keep
 * rendering on the server: it is the page a land registry opens from a QR code,
 * often on poor mobile data, and it should arrive as HTML rather than after a
 * bundle boots.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
