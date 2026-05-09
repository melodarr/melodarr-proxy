"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/insights", label: "Insights" },
  { href: "/analytics", label: "Analytics" },
  { href: "/requests", label: "Requests" },
  { href: "/explorer", label: "Explorer" },
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/network", label: "Network" },
  { href: "/lidarr-mirror", label: "Lidarr Mirror" },
  { href: "/settings", label: "Settings" },
  { href: "/updates", label: "Updates" },
];

export function HeaderNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="lg:hidden p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 min-h-[44px] min-w-[44px] flex items-center justify-center"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle menu"
        aria-expanded={isOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isOpen ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </>
          ) : (
            <>
              <line x1="4" y1="12" x2="20" y2="12"></line>
              <line x1="4" y1="6" x2="20" y2="6"></line>
              <line x1="4" y1="18" x2="20" y2="18"></line>
            </>
          )}
        </svg>
      </button>

      <nav className="hidden lg:flex items-center gap-1 text-sm text-secondary w-full overflow-x-auto scrollbar-hide" aria-label="Primary navigation">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-4 py-3 min-h-[44px] flex items-center justify-center transition-colors ${
                active
                  ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100"
                  : "hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        <a
          href="/docs"
          className="whitespace-nowrap rounded-md px-4 py-3 min-h-[44px] flex items-center justify-center transition-colors hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:text-white"
        >
          API Docs
        </a>
      </nav>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed bottom-0 left-0 right-0 bg-page/95 backdrop-blur-xl border-t border-border p-4 pt-2 pb-8 flex flex-col gap-2 shadow-[0_-10px_40px_rgba(0,0,0,0.2)] z-50 lg:hidden max-h-[85vh] overflow-y-auto rounded-t-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
          >
            <div className="w-12 h-1.5 bg-border/50 rounded-full mx-auto mb-2 shrink-0" />
            {links.map((link, index) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  autoFocus={index === 0}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-4 py-3 min-h-[48px] flex items-center transition-colors font-medium ${
                    active
                      ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100"
                      : "hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:text-white text-secondary"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <a
              href="/docs"
              className="rounded-xl px-4 py-3 min-h-[48px] flex items-center transition-colors hover:bg-black/5 hover:text-black dark:hover:bg-card dark:hover:text-white text-secondary font-medium"
            >
              API Docs
            </a>
          </div>
        </>
      )}
    </>
  );
}
