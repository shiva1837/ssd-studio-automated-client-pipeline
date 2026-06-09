'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">SS</span>
              </div>
              <span className="font-bold text-xl tracking-tight">SSD Studio</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-md">
              Professional photography and videography services. Capturing moments that matter
              with precision, artistry, and a commitment to excellence.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">Services</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Portrait Sessions</li>
              <li>Commercial Shoots</li>
              <li>Event Coverage</li>
              <li>Brand Campaigns</li>
              <li>Product Photography</li>
              <li>Video Production</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">Company</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/" className="hover:text-foreground transition-colors">Home</Link></li>
              <li><Link href="/login" className="hover:text-foreground transition-colors">Login</Link></li>
              <li><Link href="/register" className="hover:text-foreground transition-colors">Register</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} SSD Studio. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
