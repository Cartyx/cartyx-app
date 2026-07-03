"""Calendar of Harptos seed config + a port of calendarEngine.toOrdinal.

Mirrors app/utils/harptos.ts and app/utils/calendarEngine.ts EXACTLY. A vitest
parity test (calendarEngine.parity.test.ts) asserts the TS engine and these
numbers agree for the seeded dates, so the two ports cannot silently diverge.
"""

HARPTOS_MONTHS = [
    {"name": "Hammer", "days": 30},
    {"name": "Midwinter", "days": 1, "isIntercalary": True},
    {"name": "Alturiak", "days": 30},
    {"name": "Ches", "days": 30},
    {"name": "Tarsakh", "days": 30},
    {"name": "Greengrass", "days": 1, "isIntercalary": True},
    {"name": "Mirtul", "days": 30},
    {"name": "Kythorn", "days": 30},
    {"name": "Flamerule", "days": 30},
    {"name": "Midsummer", "days": 1, "isIntercalary": True},
    {"name": "Shieldmeet", "days": 0, "isIntercalary": True},
    {"name": "Eleasis", "days": 30},
    {"name": "Eleint", "days": 30},
    {"name": "Highharvestide", "days": 1, "isIntercalary": True},
    {"name": "Marpenoth", "days": 30},
    {"name": "Uktar", "days": 30},
    {"name": "The Feast of the Moon", "days": 1, "isIntercalary": True},
    {"name": "Nightal", "days": 30},
]

HARPTOS = {
    "name": "Calendar of Harptos",
    "description": "The calendar of the Forgotten Realms, devised by Harptos of Kaalinth.",
    "months": HARPTOS_MONTHS,
    "weekdays": ["First", "Second", "Third", "Fourth", "Fifth",
                 "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"],
    "weekdayMode": "resetEachMonth",
    "epoch": {"year": 1372, "weekdayIndex": 0},
    "yearSuffix": "DR",
    "namedYears": [
        {"year": 1358, "name": "Year of Shadows"},
        {"year": 1385, "name": "Year of Blue Fire"},
    ],
    "leapDays": [{"name": "Shieldmeet", "monthIndex": 10, "interval": 4, "offset": 0, "addDays": 1}],
    "moons": [{"name": "Selûne", "cycleLength": 30, "offsetDays": 0}],
    "seasons": [
        {"name": "Winter", "startMonthIndex": 0, "startDay": 1},
        {"name": "Spring", "startMonthIndex": 3, "startDay": 1},
        {"name": "Summer", "startMonthIndex": 8, "startDay": 1},
        {"name": "Autumn", "startMonthIndex": 13, "startDay": 1},
    ],
    "holidays": [],
    "currentDate": {"year": 1491, "monthIndex": 6, "day": 15},
}


def _leap_applies(rule, year):
    if rule["interval"] < 1:
        return False
    return (year - rule["offset"]) % rule["interval"] == 0


def days_in_month(cfg, year, month_index):
    base = cfg["months"][month_index]["days"]
    extra = sum(r["addDays"] for r in cfg["leapDays"]
                if r["monthIndex"] == month_index and _leap_applies(r, year))
    return base + extra


def days_in_year(cfg, year):
    return sum(days_in_month(cfg, year, m) for m in range(len(cfg["months"])))


def to_ordinal(cfg, date):
    year, month_index, day = date["year"], date["monthIndex"], date["day"]
    epoch_year = cfg["epoch"]["year"]
    if year >= epoch_year:
        year_start = sum(days_in_year(cfg, y) for y in range(epoch_year, year))
    else:
        year_start = -sum(days_in_year(cfg, y) for y in range(year, epoch_year))
    before_month = sum(days_in_month(cfg, year, m) for m in range(month_index))
    return year_start + before_month + (day - 1)
