import React from 'react';
import type { CalendarConfig, CalDate } from '~/utils/calendarEngine';
import { daysInMonth } from '~/utils/calendarEngine';

interface CalDatePickerProps {
  cfg: CalendarConfig;
  value: CalDate;
  onChange: (d: CalDate) => void;
  disabled?: boolean;
  idPrefix: string;
}

export function CalDatePicker({
  cfg,
  value,
  onChange,
  disabled = false,
  idPrefix,
}: CalDatePickerProps) {
  const maxDay = daysInMonth(cfg, value.year, value.monthIndex);
  const isZeroLengthMonth = maxDay === 0;

  function handleYearChange(e: React.ChangeEvent<HTMLInputElement>) {
    const year = parseInt(e.target.value, 10);
    if (!Number.isFinite(year)) return;
    const newMax = daysInMonth(cfg, year, value.monthIndex);
    const clampedDay = newMax === 0 ? 1 : Math.min(value.day, newMax);
    onChange({ year, monthIndex: value.monthIndex, day: clampedDay });
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const monthIndex = parseInt(e.target.value, 10);
    const newMax = daysInMonth(cfg, value.year, monthIndex);
    const clampedDay = newMax === 0 ? 1 : Math.min(value.day, newMax);
    onChange({ year: value.year, monthIndex, day: clampedDay });
  }

  function handleDayChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const day = parseInt(e.target.value, 10);
    onChange({ year: value.year, monthIndex: value.monthIndex, day });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Year */}
      <input
        type="number"
        data-testid={`${idPrefix}-year`}
        value={value.year}
        onChange={handleYearChange}
        disabled={disabled}
        className="w-20 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 text-xs font-sans text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
      />

      {/* Month */}
      <select
        data-testid={`${idPrefix}-month`}
        value={value.monthIndex}
        onChange={handleMonthChange}
        disabled={disabled}
        className="rounded-md border border-white/[0.1] bg-[#0d1117] px-2 py-1.5 text-xs font-sans text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {cfg.months.map((m, i) => (
          <option key={i} value={i}>
            {m.name}
          </option>
        ))}
      </select>

      {/* Day */}
      {isZeroLengthMonth ? (
        <span className="text-xs text-amber-400/80 italic">no days this year</span>
      ) : (
        <select
          data-testid={`${idPrefix}-day`}
          value={value.day}
          onChange={handleDayChange}
          disabled={disabled}
          className="rounded-md border border-white/[0.1] bg-[#0d1117] px-2 py-1.5 text-xs font-sans text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
