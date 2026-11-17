import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BetterCSP | Rutgers Course Planner",
  description: "Explore Rutgers courses, section meetings, and registration notes with clarity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a className="skip-link" href="#content">Skip to content</a>
        <div className="site-header"><Link className="brand" href="/">better<span>csp</span><span className="brand-dot" aria-hidden="true">.</span></Link><span>Rutgers, with a clearer plan.</span><nav className="site-nav" aria-label="Main navigation"><Link href="/">Courses</Link><Link href="/planner">Planner</Link></nav></div>
        <div id="content">{children}</div>
        <footer className="site-footer"><span>Independent of Rutgers University.</span><span>Plan thoughtfully. Verify with WebReg.</span></footer>
      </body>
    </html>
  );
}
