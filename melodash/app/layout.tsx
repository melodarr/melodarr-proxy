import type { Metadata } from "next";
import "./globals.css";
import { HeaderNav } from "@/components/HeaderNav";

export const metadata: Metadata = {
  title: "Melodarr Proxy | Control Plane",
  description: "Melodarr Proxy control plane",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans">
        <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex min-h-14 max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-8 py-3">
            <span className="font-bold tracking-tight text-lg flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.6)]"></span>
              Melodarr Proxy
            </span>
            <HeaderNav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
