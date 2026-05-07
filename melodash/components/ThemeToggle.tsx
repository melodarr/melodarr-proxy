'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
 const { theme, setTheme } = useTheme();
 const [mounted, setMounted] = useState(false);

 useEffect(() => {
 setMounted(true);
 }, []);

 if (!mounted) {
 return <div className="w-9 h-9" />; // Placeholder to avoid layout shift
 }

 const cycleTheme = () => {
 if (theme === 'system') setTheme('light');
 else if (theme === 'light') setTheme('dark');
 else setTheme('system');
 };

 return (
 <button
 onClick={cycleTheme}
 className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-card transition-colors"
 title={`Theme: ${theme}`}
 >
 {theme === 'system' ? (
 <Monitor className="h-5 w-5 text-muted" />
 ) : theme === 'dark' ? (
 <Moon className="h-5 w-5 text-secondary hover:text-black dark:hover:text-white" />
 ) : (
 <Sun className="h-5 w-5 text-secondary hover:text-black dark:hover:text-white" />
 )}
 <span className="sr-only">Toggle theme</span>
 </button>
 );
}
