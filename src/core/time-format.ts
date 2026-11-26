const SECONDS_PER_MINUTE = 60;
const TENTHS_PER_SECOND = 10;
const SECONDS_DIGITS = 2;

/** "m:ss"（秒は切り捨て） */
export function formatClock(sec: number): string {
  const whole = Math.floor(Math.max(0, sec));
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const seconds = whole - minutes * SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(SECONDS_DIGITS, '0')}`;
}

/** "m:ss.s"（0.1 秒単位に丸めてから分・秒に分けるので "0:60.0" にはならない） */
export function formatClockTenths(sec: number): string {
  const tenths = Math.round(Math.max(0, sec) * TENTHS_PER_SECOND);
  const tenthsPerMinute = SECONDS_PER_MINUTE * TENTHS_PER_SECOND;
  const minutes = Math.floor(tenths / tenthsPerMinute);
  const rest = tenths - minutes * tenthsPerMinute;
  const seconds = Math.floor(rest / TENTHS_PER_SECOND);
  return `${minutes}:${String(seconds).padStart(SECONDS_DIGITS, '0')}.${rest % TENTHS_PER_SECOND}`;
}
