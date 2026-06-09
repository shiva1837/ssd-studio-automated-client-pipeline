import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SSD Studio — Professional Photography & Videography',
  description:
    'Book professional photography and videography services. Portrait sessions, commercial shoots, event coverage, brand campaigns, and more.',
  keywords: ['photography', 'videography', 'studio', 'booking', 'professional'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}><Providers>{children}</Providers></body>
    </html>
  );
}
