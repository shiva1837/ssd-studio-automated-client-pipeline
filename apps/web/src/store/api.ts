import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getToken } from '@/lib/auth';

// ============================================================
// SSD Studio — RTK Query API Slice
// Communicates with the Express backend at /api/*
// ============================================================

export interface Booking {
  id: string;
  clientId: string;
  serviceType: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  amountPaid: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  mediaAssets?: Array<{
    id: string;
    assetType: string;
    deliveryStatus: string;
  }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
}

const baseQuery = fetchBaseQuery({
  baseUrl: `${process.env.NEXT_PUBLIC_API_URL}`,
  prepareHeaders: (headers) => {
    const token = getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

export const ssdApi = createApi({
  reducerPath: 'ssdApi',
  baseQuery,
  tagTypes: ['Booking', 'User', 'Media'],
  endpoints: (builder) => ({
    // Auth
    login: builder.mutation<{ data: User; token: string }, { email: string; password: string }>({
      query: (body) => ({
        url: '/auth/login',
        method: 'POST',
        body,
      }),
    }),
    register: builder.mutation<{ data: User; token: string }, { email: string; name: string; phone: string; password: string }>({
      query: (body) => ({
        url: '/auth/register',
        method: 'POST',
        body,
      }),
    }),
    getMe: builder.query<{ data: User }, void>({
      query: () => '/auth/me',
      providesTags: ['User'],
    }),

    // Bookings
    getMyBookings: builder.query<PaginatedResponse<Booking>, { status?: string; page?: number; limit?: number } | void>({
      query: (params) => ({
        url: '/bookings',
        params: params || {},
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({ type: 'Booking' as const, id })),
              { type: 'Booking', id: 'LIST' },
            ]
          : [{ type: 'Booking', id: 'LIST' }],
    }),
    getBooking: builder.query<{ data: Booking }, string>({
      query: (id) => `/bookings/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Booking', id }],
    }),
    createBooking: builder.mutation<
      { data: Booking; message: string },
      { serviceType: string; startTime: string; endTime: string; notes?: string }
    >({
      query: (body) => ({
        url: '/bookings',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Booking', id: 'LIST' }],
    }),
    updateBooking: builder.mutation<
      { data: Booking },
      { id: string; status?: string; notes?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/bookings/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Booking', id }],
    }),
    cancelBooking: builder.mutation<{ message: string }, string>({
      query: (id) => ({
        url: `/bookings/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Booking', id }, { type: 'Booking', id: 'LIST' }],
    }),
    checkAvailability: builder.query<
      { available: boolean; hasConflict: boolean; hasActiveLock: boolean },
      { startTime: string; endTime: string }
    >({
      query: (params) => ({
        url: '/bookings/availability',
        params,
      }),
    }),

    // Media
    getBookingMedia: builder.query<{ data: any[] }, string>({
      query: (bookingId) => `/media/${bookingId}`,
      providesTags: (_result, _error, bookingId) => [{ type: 'Media', id: bookingId }],
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useGetMeQuery,
  useGetMyBookingsQuery,
  useGetBookingQuery,
  useCreateBookingMutation,
  useUpdateBookingMutation,
  useCancelBookingMutation,
  useCheckAvailabilityQuery,
  useGetBookingMediaQuery,
} = ssdApi;
