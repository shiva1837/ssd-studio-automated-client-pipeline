import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SSD Studio — Book Your Session',
  description:
    'Reserve your creative studio session. Real-time availability, instant confirmation, and a fully automated delivery pipeline.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <Providers>
          <header className="border-b border-neutral-800">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
              <a href="/" className="text-lg font-semibold tracking-tight">
                SSD&nbsp;Studio
              </a>
              <nav className="flex gap-6 text-sm text-neutral-400">
                <a href="/book" className="hover:text-neutral-100">
                  Book
                </a>
                <a href="/terms" className="hover:text-neutral-100">
                  Terms
                </a>
                <a href="/privacy" className="hover:text-neutral-100">
                  Privacy
                </a>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
          <footer className="border-t border-neutral-800 py-6 text-center text-xs text-neutral-500">
            &copy; {new Date().getFullYear()} SSD Studio. All rights reserved.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
