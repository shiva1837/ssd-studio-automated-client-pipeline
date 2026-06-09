'use client';

import { Calendar } from '@ssd-studio/ui';

interface BookingCalendarProps {
  selected?: Date;
  onSelect: (date: Date) => void;
  fromDate?: Date;
  toDate?: Date;
  disabled?: (date: Date) => boolean;
}

export default function BookingCalendar({
  selected,
  onSelect,
  fromDate,
  toDate,
  disabled,
}: BookingCalendarProps) {
  return (
    <div className="flex justify-center">
      <Calendar
        selected={selected}
        onSelect={onSelect}
        fromDate={fromDate}
        toDate={toDate}
        disabled={disabled}
      />
    </div>
  );
}
