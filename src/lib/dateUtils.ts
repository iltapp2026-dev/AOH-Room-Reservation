import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addDays, isPast } from 'date-fns';

export const getMonthDays = (date: Date) => {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const startVisible = startOfWeek(start, { weekStartsOn: 1 });
  const endVisible = endOfWeek(end, { weekStartsOn: 1 });
  
  return eachDayOfInterval({ start: startVisible, end: endVisible });
};

export const getNextMonthFirstWeek = (date: Date) => {
  const nextMonth = addMonths(date, 1);
  const start = startOfMonth(nextMonth);
  // Get first 7 days
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDays(start, i));
  }
  return days;
};

export const formatDateKey = (date: Date) => format(date, 'yyyy-MM-dd');
export const formatDisplayDate = (date: Date) => format(date, 'MMM d, yyyy');
export const formatFullDate = (date: Date) => format(date, 'EEEE, MMMM do, yyyy');

export const isDateBookable = (date: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Within current month or first 7 days of next month
  const startOfThisMonth = startOfMonth(new Date());
  const nextMonthRange = addDays(startOfMonth(addMonths(new Date(), 1)), 6);
  
  return date >= today && date <= nextMonthRange;
};
