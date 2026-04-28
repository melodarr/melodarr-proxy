"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/insights", label: "Insights" },
  { href: "/analytics", label: "Analytics" },
  { href: "/requests", label: "Requests" },
  { href: "/explorer", label: "Explorer" },
  { href: "/settings", label: "Settings" },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-400" aria-label="Primary navigation">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              active
                ? "bg-white/10 text-white"
                : "hover:bg-white/5 hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
