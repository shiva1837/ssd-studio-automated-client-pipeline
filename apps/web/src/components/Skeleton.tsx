'use client';

/**
 * Pulse-animated placeholder block for loading states.
 * Size it with width/height utility classes via className.
 */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden="true" />;
}
