import type { Metadata } from "next";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";

import { Providers } from "./providers";

import "./globals.css";

/*
 * The same two faces the mobile app uses: Playfair for headings, Source Sans
 * for body. A Certificate of Compliance is a legal document, and it should
 * look the same whether it was opened on a phone or verified in this console.
 */
const playfair = Playfair_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const sourceSans = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NBA Legal Fees — Branch Console",
  description:
    "Branch administration for the NBA Legal Fees platform: verify payments, issue BAINs and Certificates of Compliance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${sourceSans.variable} h-full`}>
      <body
        className="min-h-full antialiased"
        style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
