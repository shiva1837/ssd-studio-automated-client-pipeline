import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center gap-8 py-16 text-center">
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
        Book your creative session in under a minute.
      </h1>
      <p className="max-w-xl text-lg text-neutral-400">
        Real-time studio availability, instant confirmation, automated reminders,
        and secure gallery delivery — all handled end to end so you can focus on
        the shoot.
      </p>
      <Link
        href="/book"
        className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-indigo-500"
      >
        Check availability
      </Link>

      <section className="mt-12 grid gap-6 sm:grid-cols-3">
        {[
          {
            title: 'Pick a slot',
            body: 'Live availability prevents double-bookings the moment you reserve.',
          },
          {
            title: 'Get confirmed',
            body: 'Instant email confirmation with a calendar invite and next steps.',
          },
          {
            title: 'Receive your gallery',
            body: 'Time-limited secure links delivered the moment editing wraps.',
          },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-left"
          >
            <h3 className="mb-2 font-semibold">{card.title}</h3>
            <p className="text-sm text-neutral-400">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
