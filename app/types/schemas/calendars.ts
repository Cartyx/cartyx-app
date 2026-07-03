import { z } from 'zod';

const calDate = z.object({
  year: z.number().int(),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(1),
});

const month = z.object({
  name: z.string().trim().min(1),
  days: z.number().int().min(0),
  isIntercalary: z.boolean().optional(),
});

const leapRule = z.object({
  name: z.string().trim().min(1),
  monthIndex: z.number().int().min(0),
  interval: z.number().int().min(1),
  offset: z.number().int(),
  addDays: z.number().int().min(1),
});

const moon = z.object({
  name: z.string().trim().min(1),
  cycleLength: z.number().positive(),
  offsetDays: z.number(),
  color: z.string().optional(),
});

const season = z.object({
  name: z.string().trim().min(1),
  startMonthIndex: z.number().int().min(0),
  startDay: z.number().int().min(1),
  color: z.string().optional(),
});

const holiday = z.object({
  name: z.string().trim().min(1),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(1),
  color: z.string().optional(),
});

const calendarFields = {
  name: z.string().trim().min(1),
  description: z.string().default(''),
  months: z.array(month).min(1),
  weekdays: z.array(z.string().trim().min(1)).min(1),
  weekdayMode: z.enum(['continuous', 'resetEachMonth']).default('continuous'),
  epoch: z.object({ year: z.number().int(), weekdayIndex: z.number().int().min(0) }),
  yearSuffix: z.string().default(''),
  namedYears: z
    .array(z.object({ year: z.number().int(), name: z.string().trim().min(1) }))
    .default([]),
  leapDays: z.array(leapRule).default([]),
  moons: z.array(moon).default([]),
  seasons: z.array(season).default([]),
  holidays: z.array(holiday).default([]),
  currentDate: calDate,
};

export const getCalendarSchema = z.object({ campaignId: z.string().trim().min(1) });
export const upsertCalendarSchema = z.object({
  campaignId: z.string().trim().min(1),
  ...calendarFields,
});
export const setCurrentDateSchema = z.object({
  campaignId: z.string().trim().min(1),
  currentDate: calDate,
});
export const deleteCalendarSchema = z.object({ campaignId: z.string().trim().min(1) });
