import type { Metadata } from "next";
import "./globals.css";
import { HeaderNav } from "@/components/HeaderNav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

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
 <html lang="en" suppressHydrationWarning>
 <body className="min-h-screen bg-page font-sans transition-colors duration-300">
 <ThemeProvider defaultTheme="dark" storageKey="melodash-theme">
 <header className="border-b border-border bg-page backdrop-blur supports-[backdrop-filter]:bg-page">
 <div className="container flex min-h-14 max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-8 py-3">
 <span className="font-bold tracking-tight text-lg flex items-center gap-2">
 <span className="h-4 w-4 rounded-full bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.6)]"></span>
 Melodarr Proxy
 </span>
 <div className="flex items-center gap-4">
 <HeaderNav />
 <ThemeToggle />
 </div>
 </div>
 </header>
 {children}
 </ThemeProvider>
 </body>
 </html>
 );
}
