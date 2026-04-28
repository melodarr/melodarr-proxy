import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DevDash | Control Plane",
  description: "Observable micro-platform control plane",
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
          <div className="container flex h-14 max-w-screen-2xl items-center px-8">
            <span className="font-bold tracking-tight text-lg flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-blue-500"></span>
              DevDash
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
