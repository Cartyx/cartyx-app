import type { CalendarConfig, CalMonth } from '~/utils/calendarEngine';

// 12 months x 30 days, 5 festivals as length-1 intercalary "months", Shieldmeet
// as a length-0 intercalary month that gains a day every 4 years. weekdayMode
// resetEachMonth: each month is three fresh 10-day tendays; festivals have no slot.
export const HARPTOS_MONTHS: CalMonth[] = [
  { name: 'Hammer', days: 30 },
  { name: 'Midwinter', days: 1, isIntercalary: true },
  { name: 'Alturiak', days: 30 },
  { name: 'Ches', days: 30 },
  { name: 'Tarsakh', days: 30 },
  { name: 'Greengrass', days: 1, isIntercalary: true },
  { name: 'Mirtul', days: 30 },
  { name: 'Kythorn', days: 30 },
  { name: 'Flamerule', days: 30 },
  { name: 'Midsummer', days: 1, isIntercalary: true },
  { name: 'Shieldmeet', days: 0, isIntercalary: true },
  { name: 'Eleasis', days: 30 },
  { name: 'Eleint', days: 30 },
  { name: 'Highharvestide', days: 1, isIntercalary: true },
  { name: 'Marpenoth', days: 30 },
  { name: 'Uktar', days: 30 },
  { name: 'The Feast of the Moon', days: 1, isIntercalary: true },
  { name: 'Nightal', days: 30 },
];

export const HARPTOS_CONFIG: CalendarConfig = {
  months: HARPTOS_MONTHS,
  weekdays: [
    'First',
    'Second',
    'Third',
    'Fourth',
    'Fifth',
    'Sixth',
    'Seventh',
    'Eighth',
    'Ninth',
    'Tenth',
  ],
  weekdayMode: 'resetEachMonth',
  epoch: { year: 1372, weekdayIndex: 0 },
  leapDays: [{ name: 'Shieldmeet', monthIndex: 10, interval: 4, offset: 0, addDays: 1 }],
  yearSuffix: 'DR',
  moons: [{ name: 'Selûne', cycleLength: 30, offsetDays: 0 }],
  seasons: [
    { name: 'Winter', startMonthIndex: 0, startDay: 1 },
    { name: 'Spring', startMonthIndex: 3, startDay: 1 },
    { name: 'Summer', startMonthIndex: 8, startDay: 1 },
    { name: 'Autumn', startMonthIndex: 13, startDay: 1 },
  ],
  holidays: [],
};
