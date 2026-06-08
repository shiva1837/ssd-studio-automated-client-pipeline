'use client';

import { useMemo, useState } from 'react';
import {
  useGetAvailabilityQuery,
  useCreateBookingMutation,
  type AvailabilitySlot,
} from '../../store/api';

const PACKAGES = [
  { id: 'portrait', label: 'Portrait (1h)' },
  { id: 'branding', label: 'Branding Session (2h)' },
  { id: 'product', label: 'Product Shoot (3h)' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function BookPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [packageType, setPackageType] = useState(PACKAGES[0].id);
  const [form, setForm] = useState({ clientName: '', clientEmail: '', clientPhone: '' });
  const [error, setError] = useState<string | null>(null);

  const { data: slots, isLoading, isError, refetch } = useGetAvailabilityQuery({ date });
  const [createBooking, { isLoading: isBooking }] = useCreateBookingMutation();

  const availableSlots = useMemo(
    () => (slots ?? []).filter((s) => s.available),
    [slots],
  );

  const canSubmit =
    selectedSlot && form.clientName.trim() && form.clientEmail.trim() && !isBooking;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedSlot) return;
    try {
      const res = await createBooking({
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        startTime: selectedSlot.start,
        packageType,
      }).unwrap();
      // Redirect to Stripe Checkout to collect the deposit.
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(
        'That slot may have just been taken. Please pick another time and try again.',
      );
      refetch();
      setSelectedSlot(null);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="mb-1 text-2xl font-semibold">Choose a time</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Pick a day to see open studio slots in real time.
        </p>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-neutral-400">Date</span>
          <input
            type="date"
            value={date}
            min={todayISO()}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedSlot(null);
            }}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2"
          />
        </label>

        {isLoading && <p className="text-sm text-neutral-400">Loading slots…</p>}
        {isError && (
          <p className="text-sm text-red-400">
            Could not load availability. <button onClick={() => refetch()} className="underline">Retry</button>
          </p>
        )}

        {!isLoading && !isError && availableSlots.length === 0 && (
          <p className="text-sm text-neutral-400">No open slots for this day.</p>
        )}

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {availableSlots.map((slot) => {
            const t = new Date(slot.start);
            const isSel = selectedSlot?.start === slot.start;
            return (
              <button
                key={slot.start}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                className={
                  'rounded-md border px-3 py-2 text-sm transition ' +
                  (isSel
                    ? 'border-indigo-500 bg-indigo-600 text-white'
                    : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500')
                }
              >
                {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="mb-4 text-lg font-semibold">Your details</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Package</span>
            <select
              value={packageType}
              onChange={(e) => setPackageType(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2"
            >
              {PACKAGES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <input
            required
            placeholder="Full name"
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.clientEmail}
            onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            type="tel"
            placeholder="Mobile (for SMS reminders, optional)"
            value={form.clientPhone}
            onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />

          {selectedSlot && (
            <p className="text-sm text-neutral-300">
              Selected:{' '}
              {new Date(selectedSlot.start).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBooking ? 'Reserving…' : 'Reserve & pay deposit'}
          </button>
          <p className="text-xs text-neutral-500">
            You will be redirected to a secure Stripe checkout to confirm your
            booking.
          </p>
        </form>
      </aside>
    </div>
  );
}
