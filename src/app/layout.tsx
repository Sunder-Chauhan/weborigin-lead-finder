import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebOrigin Lead Finder",
  description: "Discover, organize, and manage professional leads from permitted sources.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
