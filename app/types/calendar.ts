import type {
  CalMonth,
  CalLeapRule,
  CalMoon,
  CalSeason,
  CalHoliday,
  CalDate,
  CalendarConfig,
} from '~/utils/calendarEngine';

export type { CalMonth, CalLeapRule, CalMoon, CalSeason, CalHoliday, CalDate };

export interface CalendarData {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  description: string;
  months: CalMonth[];
  weekdays: string[];
  weekdayMode: 'continuous' | 'resetEachMonth';
  epoch: { year: number; weekdayIndex: number };
  yearSuffix: string;
  namedYears: { year: number; name: string }[];
  leapDays: CalLeapRule[];
  moons: CalMoon[];
  seasons: CalSeason[];
  holidays: CalHoliday[];
  currentDate: CalDate;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export function calendarConfigFromData(c: CalendarData): CalendarConfig {
  return {
    months: c.months,
    weekdays: c.weekdays,
    weekdayMode: c.weekdayMode,
    epoch: c.epoch,
    yearSuffix: c.yearSuffix,
    leapDays: c.leapDays,
    moons: c.moons,
    seasons: c.seasons,
    holidays: c.holidays,
  };
}
