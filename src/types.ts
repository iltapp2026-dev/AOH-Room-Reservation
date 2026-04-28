export interface User {
  firstName: string;
  lastName: string;
  email: string;
  pin: string;
}

export interface Booking {
  id: string;
  roomId: number;
  date: string; // ISO YYYY-MM-DD
  email: string;
  firstName: string;
  lastName: string;
  purpose?: string;
}

export const ROOMS = [
  'Conference Room 1',
  'Conference Room 2',
  'Conference Room 3',
  'Conference Room 4'
];

export const COLORS = {
  maroon: '#7B1113',
  maroonDark: '#5C0D0F',
  navy: '#1B365D',
  navyLight: '#264a73',
};
