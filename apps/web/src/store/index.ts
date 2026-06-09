'use client';

import { configureStore } from '@reduxjs/toolkit';
import { ssdApi } from './api';

/**
 * Redux store with RTK Query middleware.
 * Wrap the app with <Provider store={store}> to enable.
 */
export const store = configureStore({
  reducer: {
    [ssdApi.reducerPath]: ssdApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }).concat(ssdApi.middleware),
  devTools: process.env.NODE_ENV !== 'production',
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
