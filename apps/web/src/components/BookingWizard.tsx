'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Card, CardContent } from '@ssd-studio/ui';
import BookingCalendar from './BookingCalendar';
import { getToken } from '@/lib/auth';

const SERVICE_TYPES = [
  { value: 'PORTRAIT_SESSION', label: 'Portrait Session' },
  { value: 'COMMERCIAL_SHOOT', label: 'Commercial Shoot' },
  { value: 'EVENT_COVERAGE', label: 'Event Coverage' },
  { value: 'BRAND_CAMPAIGN', label: 'Brand Campaign' },
  { value: 'PRODUCT_PHOTOGRAPHY', label: 'Product Photography' },
  { value: 'VIDEO_PRODUCTION', label: 'Video Production' },
];

interface BookingForm {
  serviceType: string;
  date: Date | null;
  startTime: string;
  endTime: string;
  notes: string;
}

export default function BookingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<BookingForm>({
    serviceType: '',
    date: null,
    startTime: '',
    endTime: '',
    notes: '',
  });

  const updateForm = (field: keyof BookingForm, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const canProceed = (): boolean => {
    if (step === 1) return !!form.serviceType;
    if (step === 2) return !!form.date;
    if (step === 3) return !!form.startTime && !!form.endTime && form.endTime > form.startTime;
    return true;
  };

  const handleSubmit = async () => {
    if (!form.date || !form.startTime || !form.endTime) return;

    setLoading(true);
    setError('');

    const startDateTime = new Date(form.date);
    const [startH, startM] = form.startTime.split(':').map(Number);
    startDateTime.setHours(startH, startM, 0, 0);

    const endDateTime = new Date(form.date);
    const [endH, endM] = form.endTime.split(':').map(Number);
    endDateTime.setHours(endH, endM, 0, 0);

    try {
      const token = getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serviceType: form.serviceType,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          notes: form.notes || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || 'Failed to create booking');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {s}
            </div>
            {s < 4 && (
              <div className={`w-12 h-0.5 ${s < step ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Service Selection */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Select a Service</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SERVICE_TYPES.map((service) => (
              <button
                key={service.value}
                onClick={() => updateForm('serviceType', service.value)}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  form.serviceType === service.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="font-medium">{service.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Date Selection */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Choose a Date</h3>
          <BookingCalendar
            selected={form.date || undefined}
            onSelect={(date) => updateForm('date', date)}
            fromDate={new Date()}
          />
        </div>
      )}

      {/* Step 3: Time Selection */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Select Time Slot</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={form.startTime}
                onChange={(e) => updateForm('startTime', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={form.endTime}
                onChange={(e) => updateForm('endTime', e.target.value)}
              />
            </div>
          </div>
          {form.date && form.startTime && (
            <p className="text-sm text-muted-foreground">
              {form.date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}{' '}
              &middot; {form.startTime} - {form.endTime || '...'}
            </p>
          )}
        </div>
      )}

      {/* Step 4: Notes & Confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Confirm Your Booking</h3>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service</span>
                <span className="font-medium">
                  {SERVICE_TYPES.find((s) => s.value === form.serviceType)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">
                  {form.date?.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-medium">
                  {form.startTime} - {form.endTime}
                </span>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (optional)</Label>
            <Input
              id="notes"
              placeholder="Any special requests or details..."
              value={form.notes}
              onChange={(e) => updateForm('notes', e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        {step > 1 ? (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        ) : (
          <div />
        )}

        {step < 4 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
            Continue
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Booking...' : 'Confirm Booking'}
          </Button>
        )}
      </div>
    </div>
  );
}
