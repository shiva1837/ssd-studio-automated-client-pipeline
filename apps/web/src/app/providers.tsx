'use client';

import { Provider } from 'react-redux';
import { store } from '../store';

/**
 * Client-side providers. Wraps the App Router tree with the Redux store so
 * RTK Query hooks work in client components. Imported by the root layout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}
