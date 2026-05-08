"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
 { href: "/dashboard", label: "Dashboard" },
 { href: "/insights", label: "Insights" },
 { href: "/analytics", label: "Analytics" },
 { href: "/requests", label: "Requests" },
 { href: "/explorer", label: "Explorer" },
 { href: "/diagnostics", label: "Diagnostics" },
 { href: "/lidarr-mirror", label: "Lidarr Mirror" },
 { href: "/settings", label: "Settings" },
 { href: "/updates", label: "Updates" },
];

export function HeaderNav() {
 const pathname = usePathname();

 return (
 <nav className="flex flex-wrap items-center gap-1 text-sm text-secondary" aria-label="Primary navigation">
 {links.map((link) => {
 const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

 return (
 <Link
 key={link.href}
 href={link.href}
 aria-current={active ? "page" : undefined}
 className={`rounded-md px-3 py-1.5 transition-colors ${
 active
 ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100"
 : "hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:bg-card dark:hover:text-white"
 }`}
 >
 {link.label}
 </Link>
 );
 })}
 <a
 href="/docs"
 className="rounded-md px-3 py-1.5 transition-colors hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:bg-card dark:hover:text-white"
 >
 API Docs
 </a>
 </nav>
 );
}
