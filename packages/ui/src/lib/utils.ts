import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — Conditional Tailwind class merger.
 * Combines clsx for conditional classes with tailwind-merge for deduplication.
 *
 * Example: cn('px-4 py-2', isActive && 'bg-blue-500', 'px-2') → 'py-2 bg-blue-500 px-2'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
