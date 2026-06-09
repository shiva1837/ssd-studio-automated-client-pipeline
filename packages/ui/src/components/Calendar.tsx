import * as React from 'react';
import { cn } from '../lib/utils';

export interface CalendarProps {
  className?: string;
  selected?: Date;
  onSelect?: (date: Date) => void;
  disabled?: (date: Date) => boolean;
  fromDate?: Date;
  toDate?: Date;
}

function getDaysInMonth(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const days: Date[] = [];
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const Calendar: React.FC<CalendarProps> = ({
  className,
  selected,
  onSelect,
  disabled,
  fromDate,
  toDate,
}) => {
  const [currentMonth, setCurrentMonth] = React.useState<Date>(
    selected || fromDate || new Date()
  );

  const days = getDaysInMonth(currentMonth);
  const firstDayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const isDisabled = (date: Date): boolean => {
    if (disabled && disabled(date)) return true;
    if (fromDate && date < fromDate) return true;
    if (toDate && date > toDate) return true;
    return false;
  };

  return (
    <div className={cn('p-3 rounded-md border bg-card text-card-foreground shadow-sm', className)}>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium h-7 w-7 hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          &lt;
        </button>
        <div className="text-sm font-medium">
          {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </div>
        <button
          onClick={nextMonth}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium h-7 w-7 hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          &gt;
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground h-8 flex items-center justify-center">
            {day}
          </div>
        ))}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map((date) => {
          const selectedDay = selected && isSameDay(date, selected);
          const disabledDay = isDisabled(date);
          return (
            <button
              key={date.toISOString()}
              disabled={disabledDay}
              onClick={() => !disabledDay && onSelect?.(date)}
              className={cn(
                'h-8 w-full rounded-md text-sm transition-colors flex items-center justify-center',
                selectedDay && 'bg-primary text-primary-foreground hover:bg-primary/90',
                !selectedDay && !disabledDay && 'hover:bg-accent hover:text-accent-foreground',
                disabledDay && 'text-muted-foreground opacity-50 cursor-not-allowed'
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
};

Calendar.displayName = 'Calendar';

export { Calendar };
