import type { Metadata } from "next";
import { SessionProvider } from "@/components/session";
import "./globals.css";
export const metadata: Metadata = {
  title: "Resonance — Good music. Better together.",
  description:
    "A shared space for your next favorite song. Create a room, invite your people, and listen together.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
