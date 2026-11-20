/**
 * 六字段或带年的七字段 cron。秒、分、时、日、月、周，可选年。
 * 日和周同时有约束时，满足其中一个即可。`*` 和 `?` 表示该字段不限制。
 * 周：0 和 7 是周日，1 是周一。`L` 是当月最后一天，`n#k` 是当月第 k 个周 n。
 */

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 周日 … 6 周六 */
  weekday: number;
  lastDay: number;
};

export function zonedTime(date: Date, timeZone: string): ZonedTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const minute = Number(parts.minute);
  const weekday = WEEKDAY[parts.weekday];
  if (!year || !month || !day || weekday === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`无法按 ${timeZone} 读取时间`);
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    lastDay: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

function matchNumber(field: string, value: number, min: number, max: number): boolean {
  return field.split(",").some((item) => {
    const [base, stepText] = item.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return false;
    if (base === "*" || base === "?") {
      return step === 1 || (value - min) % step === 0;
    }
    const range = base.split("-");
    if (range.length === 2) {
      const start = Number(range[0]);
      const end = Number(range[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
      return value >= start && value <= end && (value - start) % step === 0;
    }
    const exact = Number(base);
    return Number.isInteger(exact) && exact >= min && exact <= max && value === exact;
  });
}

function dayMatches(field: string, time: ZonedTime): boolean {
  if (field === "L") return time.day === time.lastDay;
  return matchNumber(field, time.day, 1, 31);
}

function weekdayMatches(field: string, time: ZonedTime): boolean {
  return field.split(",").some((item) => {
    const nth = /^([0-7])#([1-5])$/.exec(item);
    if (nth) {
      const target = Number(nth[1]) % 7;
      const index = Number(nth[2]);
      if (time.weekday !== target) return false;
      return Math.floor((time.day - 1) / 7) + 1 === index;
    }
    return matchNumber(item, time.weekday, 0, 7) || (time.weekday === 0 && matchNumber(item, 7, 0, 7));
  });
}

function constrained(field: string): boolean {
  return field !== "*" && field !== "?";
}

/** 本次触发时刻，精确到分钟，UTC。同一分钟重试会得到同一个 scheduled_at。 */
export function scheduledAtIso(date: Date): string {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
}

/** 当前这一分钟是否该跑。表达式不合法时返回 false。 */
export function cronMatches(expr: string, date: Date, timeZone = "Asia/Shanghai"): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 6 && fields.length !== 7) return false;
  const [second, minute, hour, day, month, weekday, year] = fields;
  let time: ZonedTime;
  try {
    time = zonedTime(date, timeZone);
  } catch {
    return false;
  }
  if (!matchNumber(second, 0, 0, 59)) return false;
  if (!matchNumber(minute, time.minute, 0, 59)) return false;
  if (!matchNumber(hour, time.hour, 0, 23)) return false;
  if (!matchNumber(month, time.month, 1, 12)) return false;
  if (year && !matchNumber(year, time.year, 1970, 9999)) return false;
  const dayOk = dayMatches(day, time);
  const weekOk = weekdayMatches(weekday, time);
  if (constrained(day) && constrained(weekday)) return dayOk || weekOk;
  if (constrained(day)) return dayOk;
  if (constrained(weekday)) return weekOk;
  return true;
}
