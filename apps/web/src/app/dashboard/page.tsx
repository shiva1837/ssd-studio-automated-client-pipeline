'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@ssd-studio/ui';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Skeleton from '@/components/Skeleton';
import { getToken } from '@/lib/auth';
import { useGetMyBookingsQuery } from '@/store/api';

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  CONFIRMED: 'default',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
};

export default function DashboardPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const { data: bookingsData, isLoading } = useGetMyBookingsQuery(undefined, {
    skip: !authenticated,
  });

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/login');
    } else {
      setAuthenticated(true);
    }
  }, [router]);

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Redirecting to login...</p>
      </div>
    );
  }

  const bookings = bookingsData?.data ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 py-12 px-4 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
          <Button onClick={() => router.push('/booking')}>New Booking</Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-44" />
                      <Skeleton className="h-4 w-72" />
                    </div>
                    <Skeleton className="h-6 w-24" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Skeleton className="h-4 w-56" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">You don&apos;t have any bookings yet.</p>
              <Button onClick={() => router.push('/booking')}>Book Your First Session</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {bookings.map((booking: any) => (
              <Card key={booking.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{booking.serviceType}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(booking.startTime).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <Badge variant={STATUS_COLORS[booking.status] || 'default'}>
                      {booking.status}
                    </Badge>
                  </div>
                </CardHeader>
                {booking.notes && (
                  <CardContent className="pt-0">
                    <p className="text-sm text-muted-foreground">{booking.notes}</p>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
