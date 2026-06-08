import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

/**
 * RTK Query API slice for the SSD Studio booking pipeline.
 *
 * The base URL points at the Express API. In production this is provided
 * via NEXT_PUBLIC_API_BASE_URL; it falls back to the local dev server.
 *
 * Auth: the JWT issued by /api/auth/login is stored in an httpOnly cookie
 * by the API where possible. For SPA flows we also read a bearer token from
 * localStorage and attach it via prepareHeaders.
 */

export interface AvailabilitySlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
  available: boolean;
}

export interface Booking {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  packageType: string;
  createdAt: string;
}

export interface CreateBookingRequest {
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  startTime: string;
  packageType: string;
}

export interface CreateBookingResponse {
  booking: Booking;
  checkoutUrl: string; // Stripe Checkout session URL
}

const baseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl,
    credentials: 'include',
    prepareHeaders: (headers) => {
      if (typeof window !== 'undefined') {
        const token = window.localStorage.getItem('ssd_token');
        if (token) headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: ['Availability', 'Booking'],
  endpoints: (builder) => ({
    // Fetch open slots for a given day (YYYY-MM-DD).
    getAvailability: builder.query<AvailabilitySlot[], { date: string }>({
      query: ({ date }) => `/api/availability?date=${encodeURIComponent(date)}`,
      providesTags: ['Availability'],
    }),

    // Reserve a slot. The API runs a SELECT ... FOR UPDATE transaction and a
    // unique constraint on (startTime) to guarantee no double-booking, then
    // returns a Stripe Checkout URL to collect the deposit.
    createBooking: builder.mutation<CreateBookingResponse, CreateBookingRequest>({
      query: (body) => ({
        url: '/api/bookings',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Availability', 'Booking'],
    }),

    getBooking: builder.query<Booking, { id: string }>({
      query: ({ id }) => `/api/bookings/${id}`,
      providesTags: ['Booking'],
    }),
  }),
});

export const {
  useGetAvailabilityQuery,
  useCreateBookingMutation,
  useGetBookingQuery,
} = api;
