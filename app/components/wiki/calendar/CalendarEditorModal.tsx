import React, { useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { CalDatePicker } from '~/components/wiki/calendar/CalDatePicker';
import { useUpsertCalendar } from '~/hooks/useCalendar';
import type { UpsertCalendarInput } from '~/hooks/useCalendar';
import { HARPTOS_CONFIG } from '~/utils/harptos';
import { validateDate } from '~/utils/calendarEngine';
import type {
  CalendarConfig,
  CalMonth,
  CalLeapRule,
  CalMoon,
  CalSeason,
  CalHoliday,
  CalDate,
} from '~/utils/calendarEngine';
import type { CalendarData } from '~/types/calendar';

// ---------------------------------------------------------------------------
// Prop interface (kept as-is from stub)
// ---------------------------------------------------------------------------

interface CalendarEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  calendar: CalendarData | null;
}

// ---------------------------------------------------------------------------
// Small helper types for row editors (no as-any)
// ---------------------------------------------------------------------------

type MonthRow = { name: string; days: number; isIntercalary: boolean };
type LeapRow = {
  name: string;
  monthIndex: number;
  interval: number;
  offset: number;
  addDays: number;
};
type MoonRow = { name: string; cycleLength: number; offsetDays: number; color: string };
type SeasonRow = { name: string; startMonthIndex: number; startDay: number; color: string };
type HolidayRow = { name: string; monthIndex: number; day: number; color: string };
type NamedYearRow = { year: number; name: string };

// ---------------------------------------------------------------------------
// Default / empty values
// ---------------------------------------------------------------------------

const DEFAULT_CURRENT_DATE: CalDate = { year: 1, monthIndex: 0, day: 1 };
const DEFAULT_MONTH: MonthRow = { name: 'Month 1', days: 30, isIntercalary: false };

function defaultFromCalendar(calendar: CalendarData | null): {
  name: string;
  description: string;
  yearSuffix: string;
  weekdayMode: 'continuous' | 'resetEachMonth';
  weekdays: string[];
  months: MonthRow[];
  leapDays: LeapRow[];
  moons: MoonRow[];
  seasons: SeasonRow[];
  holidays: HolidayRow[];
  namedYears: NamedYearRow[];
  currentDate: CalDate;
  epochYear: number;
  epochWeekdayIndex: number;
} {
  if (!calendar) {
    return {
      name: '',
      description: '',
      yearSuffix: '',
      weekdayMode: 'resetEachMonth',
      weekdays: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'],
      months: [DEFAULT_MONTH],
      leapDays: [],
      moons: [],
      seasons: [],
      holidays: [],
      namedYears: [],
      currentDate: DEFAULT_CURRENT_DATE,
      epochYear: 1,
      epochWeekdayIndex: 0,
    };
  }
  return {
    name: calendar.name,
    description: calendar.description,
    yearSuffix: calendar.yearSuffix,
    weekdayMode: calendar.weekdayMode,
    weekdays: calendar.weekdays.slice(),
    months: calendar.months.map((m) => ({
      name: m.name,
      days: m.days,
      isIntercalary: !!m.isIntercalary,
    })),
    leapDays: calendar.leapDays.map((l) => ({
      name: l.name,
      monthIndex: l.monthIndex,
      interval: l.interval,
      offset: l.offset,
      addDays: l.addDays,
    })),
    moons: (calendar.moons ?? []).map((m) => ({
      name: m.name,
      cycleLength: m.cycleLength,
      offsetDays: m.offsetDays,
      color: m.color ?? '',
    })),
    seasons: (calendar.seasons ?? []).map((s) => ({
      name: s.name,
      startMonthIndex: s.startMonthIndex,
      startDay: s.startDay,
      color: s.color ?? '',
    })),
    holidays: (calendar.holidays ?? []).map((h) => ({
      name: h.name,
      monthIndex: h.monthIndex,
      day: h.day,
      color: h.color ?? '',
    })),
    namedYears: calendar.namedYears.map((ny) => ({ year: ny.year, name: ny.name })),
    currentDate: { ...calendar.currentDate },
    epochYear: calendar.epoch.year,
    epochWeekdayIndex: calendar.epoch.weekdayIndex,
  };
}

// ---------------------------------------------------------------------------
// Shared sub-component styling helpers
// ---------------------------------------------------------------------------

const sectionLabelCls = 'block text-xs font-semibold text-slate-400 mb-2 tracking-wide';
const inputCls =
  'bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 placeholder-slate-600';
const smallInputCls = inputCls + ' w-20';
const rowBtnCls =
  'p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors';
const addBtnCls =
  'inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-white/10 text-xs text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors';

// ---------------------------------------------------------------------------
// Generic "string list" editor (weekdays)
// ---------------------------------------------------------------------------

function WeekdayEditor({
  weekdays,
  onChange,
  disabled,
}: {
  weekdays: string[];
  onChange: (days: string[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, val: string) => {
    const next = weekdays.slice();
    next[idx] = val;
    onChange(next);
  };
  const remove = (idx: number) => onChange(weekdays.filter((_, i) => i !== idx));
  const add = () => onChange([...weekdays, `Day ${weekdays.length + 1}`]);

  return (
    <div className="space-y-1.5">
      {weekdays.map((day, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-xs text-slate-600 w-5 shrink-0">{idx + 1}.</span>
          <input
            className={inputCls + ' flex-1'}
            value={day}
            onChange={(e) => update(idx, e.target.value)}
            disabled={disabled}
            placeholder={`Day ${idx + 1}`}
          />
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled || weekdays.length <= 1}
            className={rowBtnCls + (weekdays.length <= 1 ? ' opacity-30 cursor-not-allowed' : '')}
            aria-label={`Remove weekday ${idx + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add weekday
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month rows editor
// ---------------------------------------------------------------------------

function MonthsEditor({
  months,
  onChange,
  disabled,
}: {
  months: MonthRow[];
  onChange: (m: MonthRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<MonthRow>) => {
    const next = months.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(months.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...months, { name: `Month ${months.length + 1}`, days: 30, isIntercalary: false }]);

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_64px_80px_28px] gap-2 text-[10px] text-slate-600 font-semibold uppercase tracking-wide px-1 mb-1">
        <span>Name</span>
        <span>Days</span>
        <span>Intercalary</span>
        <span />
      </div>
      {months.map((m, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_64px_80px_28px] gap-2 items-center">
          <input
            className={inputCls + ' w-full'}
            value={m.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            disabled={disabled}
            placeholder={`Month ${idx + 1}`}
          />
          <input
            type="number"
            className={inputCls + ' w-full'}
            value={m.days}
            min={0}
            onChange={(e) => update(idx, { days: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            disabled={disabled}
          />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={m.isIntercalary}
              onChange={(e) => update(idx, { isIntercalary: e.target.checked })}
              disabled={disabled}
              className="rounded"
            />
            <span className="text-xs text-slate-500">Intercalary</span>
          </label>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled || months.length <= 1}
            className={rowBtnCls + (months.length <= 1 ? ' opacity-30 cursor-not-allowed' : '')}
            aria-label={`Remove month ${idx + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add month
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leap days editor
// ---------------------------------------------------------------------------

function LeapDaysEditor({
  leapDays,
  months,
  onChange,
  disabled,
}: {
  leapDays: LeapRow[];
  months: MonthRow[];
  onChange: (l: LeapRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<LeapRow>) => {
    const next = leapDays.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(leapDays.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...leapDays, { name: '', monthIndex: 0, interval: 4, offset: 0, addDays: 1 }]);

  return (
    <div className="space-y-2">
      {leapDays.map((l, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Name</span>
            <input
              className={inputCls + ' w-32'}
              value={l.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              disabled={disabled}
              placeholder="Leap day name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Month</span>
            <select
              className={inputCls}
              value={l.monthIndex}
              onChange={(e) => update(idx, { monthIndex: parseInt(e.target.value, 10) })}
              disabled={disabled}
            >
              {months.map((m, mi) => (
                <option key={mi} value={mi}>
                  {m.name || `Month ${mi + 1}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Interval</span>
            <input
              type="number"
              className={smallInputCls}
              value={l.interval}
              min={1}
              onChange={(e) =>
                update(idx, { interval: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Offset</span>
            <input
              type="number"
              className={smallInputCls}
              value={l.offset}
              onChange={(e) => update(idx, { offset: parseInt(e.target.value, 10) || 0 })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Add days</span>
            <input
              type="number"
              className={smallInputCls}
              value={l.addDays}
              min={1}
              onChange={(e) =>
                update(idx, { addDays: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className={rowBtnCls}
            aria-label="Remove leap rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add leap rule
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moons editor
// ---------------------------------------------------------------------------

function MoonsEditor({
  moons,
  onChange,
  disabled,
}: {
  moons: MoonRow[];
  onChange: (m: MoonRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<MoonRow>) => {
    const next = moons.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(moons.filter((_, i) => i !== idx));
  const add = () => onChange([...moons, { name: '', cycleLength: 30, offsetDays: 0, color: '' }]);

  return (
    <div className="space-y-2">
      {moons.map((m, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Name</span>
            <input
              className={inputCls + ' w-28'}
              value={m.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              disabled={disabled}
              placeholder="Moon name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Cycle (days)</span>
            <input
              type="number"
              className={smallInputCls}
              value={m.cycleLength}
              min={1}
              onChange={(e) =>
                update(idx, { cycleLength: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Offset days</span>
            <input
              type="number"
              className={smallInputCls}
              value={m.offsetDays}
              onChange={(e) => update(idx, { offsetDays: parseInt(e.target.value, 10) || 0 })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Color</span>
            <input
              className={inputCls + ' w-20'}
              value={m.color}
              onChange={(e) => update(idx, { color: e.target.value })}
              disabled={disabled}
              placeholder="#hex"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className={rowBtnCls}
            aria-label="Remove moon"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add moon
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seasons editor
// ---------------------------------------------------------------------------

function SeasonsEditor({
  seasons,
  months,
  onChange,
  disabled,
}: {
  seasons: SeasonRow[];
  months: MonthRow[];
  onChange: (s: SeasonRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<SeasonRow>) => {
    const next = seasons.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(seasons.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...seasons, { name: '', startMonthIndex: 0, startDay: 1, color: '' }]);

  return (
    <div className="space-y-2">
      {seasons.map((s, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Name</span>
            <input
              className={inputCls + ' w-28'}
              value={s.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              disabled={disabled}
              placeholder="Season name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Start month</span>
            <select
              className={inputCls}
              value={s.startMonthIndex}
              onChange={(e) => update(idx, { startMonthIndex: parseInt(e.target.value, 10) })}
              disabled={disabled}
            >
              {months.map((m, mi) => (
                <option key={mi} value={mi}>
                  {m.name || `Month ${mi + 1}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Start day</span>
            <input
              type="number"
              className={smallInputCls}
              value={s.startDay}
              min={1}
              onChange={(e) =>
                update(idx, { startDay: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Color</span>
            <input
              className={inputCls + ' w-20'}
              value={s.color}
              onChange={(e) => update(idx, { color: e.target.value })}
              disabled={disabled}
              placeholder="#hex"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className={rowBtnCls}
            aria-label="Remove season"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add season
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holidays editor
// ---------------------------------------------------------------------------

function HolidaysEditor({
  holidays,
  months,
  onChange,
  disabled,
}: {
  holidays: HolidayRow[];
  months: MonthRow[];
  onChange: (h: HolidayRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<HolidayRow>) => {
    const next = holidays.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(holidays.filter((_, i) => i !== idx));
  const add = () => onChange([...holidays, { name: '', monthIndex: 0, day: 1, color: '' }]);

  return (
    <div className="space-y-2">
      {holidays.map((h, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Name</span>
            <input
              className={inputCls + ' w-28'}
              value={h.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              disabled={disabled}
              placeholder="Holiday name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Month</span>
            <select
              className={inputCls}
              value={h.monthIndex}
              onChange={(e) => update(idx, { monthIndex: parseInt(e.target.value, 10) })}
              disabled={disabled}
            >
              {months.map((m, mi) => (
                <option key={mi} value={mi}>
                  {m.name || `Month ${mi + 1}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Day</span>
            <input
              type="number"
              className={smallInputCls}
              value={h.day}
              min={1}
              onChange={(e) => update(idx, { day: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-600">Color</span>
            <input
              className={inputCls + ' w-20'}
              value={h.color}
              onChange={(e) => update(idx, { color: e.target.value })}
              disabled={disabled}
              placeholder="#hex"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className={rowBtnCls}
            aria-label="Remove holiday"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add holiday
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Named years editor
// ---------------------------------------------------------------------------

function NamedYearsEditor({
  namedYears,
  onChange,
  disabled,
}: {
  namedYears: NamedYearRow[];
  onChange: (ny: NamedYearRow[]) => void;
  disabled: boolean;
}) {
  const update = (idx: number, patch: Partial<NamedYearRow>) => {
    const next = namedYears.slice();
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(namedYears.filter((_, i) => i !== idx));
  const add = () => onChange([...namedYears, { year: 1, name: '' }]);

  return (
    <div className="space-y-1.5">
      {namedYears.map((ny, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="number"
            className={smallInputCls}
            value={ny.year}
            onChange={(e) => update(idx, { year: parseInt(e.target.value, 10) || 0 })}
            disabled={disabled}
          />
          <input
            className={inputCls + ' flex-1'}
            value={ny.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            disabled={disabled}
            placeholder="Year name"
          />
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className={rowBtnCls}
            aria-label="Remove named year"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} disabled={disabled} className={addBtnCls}>
        <Plus className="h-3 w-3" />
        Add named year
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className={sectionLabelCls}>{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CalendarEditorModal({
  isOpen,
  onClose,
  campaignId,
  calendar,
}: CalendarEditorModalProps) {
  const isEdit = calendar !== null;
  const { save, isLoading: isSaving } = useUpsertCalendar();

  // ---- Form state ----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [yearSuffix, setYearSuffix] = useState('');
  const [weekdayMode, setWeekdayMode] = useState<'continuous' | 'resetEachMonth'>('resetEachMonth');
  const [weekdays, setWeekdays] = useState<string[]>(['First']);
  const [months, setMonths] = useState<MonthRow[]>([DEFAULT_MONTH]);
  const [leapDays, setLeapDays] = useState<LeapRow[]>([]);
  const [moons, setMoons] = useState<MoonRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [namedYears, setNamedYears] = useState<NamedYearRow[]>([]);
  const [currentDate, setCurrentDate] = useState<CalDate>(DEFAULT_CURRENT_DATE);
  const [epochYear, setEpochYear] = useState(1);
  const [epochWeekdayIndex, setEpochWeekdayIndex] = useState(0);

  // ---- Error / warning state ----
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; currentDate?: string }>({});
  const [warningBanner, setWarningBanner] = useState<string | null>(null);

  // ---- Populate / reset when modal opens ----
  // We use a ref-free approach: populate on each open, using isOpen as the trigger.
  // (useModalForm is LoreModal-specific; we inline equivalent logic.)
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  const openKey = isOpen ? (calendar?.id ?? '__new__') : null;

  if (openKey !== lastOpenKey) {
    // Synchronous state update during render (React's prescribed pattern for
    // "derived from props" — keeps all state in sync without useEffect).
    setLastOpenKey(openKey);
    if (openKey !== null) {
      const d = defaultFromCalendar(calendar);
      setName(d.name);
      setDescription(d.description);
      setYearSuffix(d.yearSuffix);
      setWeekdayMode(d.weekdayMode);
      setWeekdays(d.weekdays);
      setMonths(d.months);
      setLeapDays(d.leapDays);
      setMoons(d.moons);
      setSeasons(d.seasons);
      setHolidays(d.holidays);
      setNamedYears(d.namedYears);
      setCurrentDate(d.currentDate);
      setEpochYear(d.epochYear);
      setEpochWeekdayIndex(d.epochWeekdayIndex);
      setError(null);
      setFieldError({});
      setWarningBanner(null);
    }
  }

  // ---- In-progress CalendarConfig (built from current form state) ----
  const cfgInProgress = useMemo((): CalendarConfig => {
    return {
      months: months.map(
        (m): CalMonth => ({
          name: m.name,
          days: m.days,
          ...(m.isIntercalary ? { isIntercalary: true } : {}),
        })
      ),
      weekdays: weekdays.length > 0 ? weekdays : ['Day'],
      weekdayMode,
      epoch: { year: epochYear, weekdayIndex: epochWeekdayIndex },
      yearSuffix,
      leapDays: leapDays.map(
        (l): CalLeapRule => ({
          name: l.name,
          monthIndex: l.monthIndex,
          interval: l.interval,
          offset: l.offset,
          addDays: l.addDays,
        })
      ),
      moons: moons.map(
        (m): CalMoon => ({
          name: m.name,
          cycleLength: m.cycleLength,
          offsetDays: m.offsetDays,
          ...(m.color ? { color: m.color } : {}),
        })
      ),
      seasons: seasons.map(
        (s): CalSeason => ({
          name: s.name,
          startMonthIndex: s.startMonthIndex,
          startDay: s.startDay,
          ...(s.color ? { color: s.color } : {}),
        })
      ),
      holidays: holidays.map(
        (h): CalHoliday => ({
          name: h.name,
          monthIndex: h.monthIndex,
          day: h.day,
          ...(h.color ? { color: h.color } : {}),
        })
      ),
    };
  }, [
    months,
    weekdays,
    weekdayMode,
    epochYear,
    epochWeekdayIndex,
    yearSuffix,
    leapDays,
    moons,
    seasons,
    holidays,
  ]);

  // Clamp currentDate monthIndex if months changed and it's now out of bounds.
  const safeCurrentDate = useMemo((): CalDate => {
    if (currentDate.monthIndex >= months.length) {
      return { year: currentDate.year, monthIndex: 0, day: 1 };
    }
    return currentDate;
  }, [currentDate, months.length]);

  // ---- Harptos preset ----
  const handleLoadHarptos = useCallback(() => {
    setName('Calendar of Harptos');
    setDescription('The official calendar of Faerûn, used throughout the Forgotten Realms.');
    setYearSuffix(HARPTOS_CONFIG.yearSuffix ?? 'DR');
    setWeekdayMode(HARPTOS_CONFIG.weekdayMode);
    setWeekdays(HARPTOS_CONFIG.weekdays.slice());
    setMonths(
      HARPTOS_CONFIG.months.map((m) => ({
        name: m.name,
        days: m.days,
        isIntercalary: !!m.isIntercalary,
      }))
    );
    setLeapDays(
      HARPTOS_CONFIG.leapDays.map((l) => ({
        name: l.name,
        monthIndex: l.monthIndex,
        interval: l.interval,
        offset: l.offset,
        addDays: l.addDays,
      }))
    );
    setMoons(
      (HARPTOS_CONFIG.moons ?? []).map((m) => ({
        name: m.name,
        cycleLength: m.cycleLength,
        offsetDays: m.offsetDays,
        color: m.color ?? '',
      }))
    );
    setSeasons(
      (HARPTOS_CONFIG.seasons ?? []).map((s) => ({
        name: s.name,
        startMonthIndex: s.startMonthIndex,
        startDay: s.startDay,
        color: s.color ?? '',
      }))
    );
    setHolidays(
      (HARPTOS_CONFIG.holidays ?? []).map((h) => ({
        name: h.name,
        monthIndex: h.monthIndex,
        day: h.day,
        color: h.color ?? '',
      }))
    );
    setNamedYears([]);
    setEpochYear(HARPTOS_CONFIG.epoch.year);
    setEpochWeekdayIndex(HARPTOS_CONFIG.epoch.weekdayIndex);
    setCurrentDate({ year: 1491, monthIndex: 6, day: 15 });
    setFieldError({});
    setError(null);
    setWarningBanner(null);
  }, []);

  // ---- Save ----
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setWarningBanner(null);

      const errors: { name?: string; currentDate?: string } = {};
      if (!name.trim()) errors.name = 'Name is required';
      if (months.length < 1) errors.name = errors.name ?? 'At least one month is required';
      if (weekdays.length < 1) errors.name = errors.name ?? 'At least one weekday is required';

      // Validate currentDate against in-progress config
      const dateCheck = validateDate(cfgInProgress, safeCurrentDate);
      if (!dateCheck.ok) {
        errors.currentDate = dateCheck.error ?? 'Current date is invalid for this calendar';
      }

      setFieldError(errors);
      if (Object.keys(errors).length > 0) return;

      const input: UpsertCalendarInput = {
        campaignId,
        name: name.trim(),
        description,
        yearSuffix,
        weekdayMode,
        weekdays,
        months: months.map(
          (m): CalMonth => ({
            name: m.name,
            days: m.days,
            ...(m.isIntercalary ? { isIntercalary: true } : {}),
          })
        ),
        leapDays: leapDays.map(
          (l): CalLeapRule => ({
            name: l.name,
            monthIndex: l.monthIndex,
            interval: l.interval,
            offset: l.offset,
            addDays: l.addDays,
          })
        ),
        moons: moons.map(
          (m): CalMoon => ({
            name: m.name,
            cycleLength: m.cycleLength,
            offsetDays: m.offsetDays,
            ...(m.color ? { color: m.color } : {}),
          })
        ),
        seasons: seasons.map(
          (s): CalSeason => ({
            name: s.name,
            startMonthIndex: s.startMonthIndex,
            startDay: s.startDay,
            ...(s.color ? { color: s.color } : {}),
          })
        ),
        holidays: holidays.map(
          (h): CalHoliday => ({
            name: h.name,
            monthIndex: h.monthIndex,
            day: h.day,
            ...(h.color ? { color: h.color } : {}),
          })
        ),
        namedYears,
        currentDate: safeCurrentDate,
        epoch: { year: epochYear, weekdayIndex: epochWeekdayIndex },
      };

      const result = await save(input);

      if (result === null) {
        setError(`Failed to ${isEdit ? 'update' : 'create'} calendar. Please try again.`);
        return;
      }

      // Non-blocking warning if events now have out-of-range dates
      const invalidCount = result.invalidEventIds?.length ?? 0;
      if (invalidCount > 0) {
        setWarningBanner(
          `${invalidCount} event${invalidCount === 1 ? '' : 's'} now ${invalidCount === 1 ? 'has a date' : 'have dates'} outside the new calendar and need${invalidCount === 1 ? 's' : ''} fixing`
        );
        // Keep modal open to show the warning; user can close manually
        return;
      }

      onClose();
    },
    [
      name,
      description,
      yearSuffix,
      weekdayMode,
      weekdays,
      months,
      leapDays,
      moons,
      seasons,
      holidays,
      namedYears,
      safeCurrentDate,
      cfgInProgress,
      epochYear,
      epochWeekdayIndex,
      campaignId,
      isEdit,
      save,
      onClose,
    ]
  );

  // Rules of Hooks: all hooks above, `if (!isOpen) return null` is AFTER all hooks.
  if (!isOpen) return null;

  const isDisabled = isSaving;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        data-testid="calendar-editor"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-editor-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="calendar-editor-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Calendar' : 'Create Calendar'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0">
          {/* Error banner */}
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Warning banner (non-blocking) */}
          {warningBanner && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs font-semibold flex items-start justify-between gap-2">
              <span>{warningBanner}</span>
              <button
                type="button"
                onClick={() => setWarningBanner(null)}
                className="text-amber-400/70 hover:text-amber-300 shrink-0"
                aria-label="Dismiss warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Harptos preset */}
          <div>
            <button
              type="button"
              data-testid="calendar-harptos-button"
              onClick={handleLoadHarptos}
              disabled={isDisabled}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Load Calendar of Harptos
            </button>
            <p className="text-[10px] text-slate-600 mt-1.5">
              Fills all fields with the Faerûnian calendar (DR reckoning).
            </p>
          </div>

          {/* Name */}
          <FormInput
            label="Calendar name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldError.name}
            required
            disabled={isDisabled}
            placeholder="e.g. Calendar of Harptos"
            data-testid="calendar-name-input"
          />

          {/* Description */}
          <div>
            <label className={sectionLabelCls} htmlFor="calendar-description">
              Description
            </label>
            <textarea
              id="calendar-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isDisabled}
              placeholder="Optional description…"
              rows={3}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm placeholder-slate-700 focus:outline-none focus:bg-white/[0.06] transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Year suffix */}
          <FormInput
            label="Year suffix"
            value={yearSuffix}
            onChange={(e) => setYearSuffix(e.target.value)}
            disabled={isDisabled}
            placeholder="e.g. DR, CE, AE"
          />

          {/* Weekday mode */}
          <Section title="Weekday mode">
            <div className="flex items-center gap-6">
              {(['continuous', 'resetEachMonth'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="weekday-mode"
                    value={mode}
                    checked={weekdayMode === mode}
                    onChange={() => setWeekdayMode(mode)}
                    disabled={isDisabled}
                    className="accent-blue-500"
                  />
                  <span className="text-xs text-slate-300">
                    {mode === 'continuous' ? 'Continuous (weeks span months)' : 'Reset each month'}
                  </span>
                </label>
              ))}
            </div>
          </Section>

          {/* Epoch */}
          <Section title="Epoch (for continuous weekday mode)">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-600" htmlFor="epoch-year">
                  Epoch year
                </label>
                <input
                  id="epoch-year"
                  type="number"
                  className={smallInputCls}
                  value={epochYear}
                  onChange={(e) => setEpochYear(parseInt(e.target.value, 10) || 0)}
                  disabled={isDisabled}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-600" htmlFor="epoch-weekday">
                  Starting weekday index (0 = first weekday)
                </label>
                <input
                  id="epoch-weekday"
                  type="number"
                  className={smallInputCls}
                  value={epochWeekdayIndex}
                  min={0}
                  onChange={(e) =>
                    setEpochWeekdayIndex(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  disabled={isDisabled}
                />
              </div>
            </div>
          </Section>

          {/* Weekdays */}
          <Section title="Weekdays (at least 1 required)">
            <WeekdayEditor weekdays={weekdays} onChange={setWeekdays} disabled={isDisabled} />
          </Section>

          {/* Months */}
          <Section title="Months (at least 1 required)">
            <MonthsEditor months={months} onChange={setMonths} disabled={isDisabled} />
          </Section>

          {/* Leap days */}
          <Section title="Leap day rules">
            <LeapDaysEditor
              leapDays={leapDays}
              months={months}
              onChange={setLeapDays}
              disabled={isDisabled}
            />
          </Section>

          {/* Moons */}
          <Section title="Moons">
            <MoonsEditor moons={moons} onChange={setMoons} disabled={isDisabled} />
          </Section>

          {/* Seasons */}
          <Section title="Seasons">
            <SeasonsEditor
              seasons={seasons}
              months={months}
              onChange={setSeasons}
              disabled={isDisabled}
            />
          </Section>

          {/* Holidays */}
          <Section title="Holidays">
            <HolidaysEditor
              holidays={holidays}
              months={months}
              onChange={setHolidays}
              disabled={isDisabled}
            />
          </Section>

          {/* Named years */}
          <Section title="Named years">
            <NamedYearsEditor
              namedYears={namedYears}
              onChange={setNamedYears}
              disabled={isDisabled}
            />
          </Section>

          {/* Current date */}
          <Section title="Current date">
            {fieldError.currentDate && (
              <p className="text-xs text-red-400 mb-1" role="alert">
                {fieldError.currentDate}
              </p>
            )}
            <CalDatePicker
              cfg={cfgInProgress}
              value={safeCurrentDate}
              onChange={setCurrentDate}
              disabled={isDisabled}
              idPrefix="calendar-current-date"
            />
          </Section>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0 gap-3">
          <PixelButton
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
            type="button"
          >
            Cancel
          </PixelButton>
          <PixelButton
            variant="primary"
            size="sm"
            disabled={isDisabled}
            type="submit"
            data-testid="calendar-save-button"
          >
            {isSaving ? 'Saving…' : isEdit ? 'Update calendar' : 'Create calendar'}
          </PixelButton>
        </footer>
      </form>
    </div>,
    document.body
  );
}
