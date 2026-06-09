'use client';

import Link from 'next/link';
import { Button } from '@ssd-studio/ui';
import { useRouter } from 'next/navigation';
import { removeToken } from '@/lib/auth';

export default function Header() {
  const router = useRouter();

  const handleLogout = () => {
    removeToken();
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">SS</span>
          </div>
          <span className="font-bold text-xl tracking-tight">SSD Studio</span>
        </Link>

        <nav className="hidden md:flex items-center space-x-6">
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Home
          </Link>
          <Link href="/dashboard" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/booking" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Book Now
          </Link>
        </nav>

        <div className="flex items-center space-x-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              Dashboard
            </Button>
          </Link>
          <Link href="/booking">
            <Button size="sm">
              Book Now
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
