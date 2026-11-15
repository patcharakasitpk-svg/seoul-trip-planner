/**
 * ไอคอนเส้นสีเดียว (stroke = currentColor) ใช้ทั้งระบบแทนอีโมจิสี — ขนาดตามตัวอักษรรอบ ๆ (1em)
 */
const s = (d: string, extra = '') =>
  `<svg class="ico i" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

export const I = {
  train: s('<rect x="5" y="3.5" width="14" height="13" rx="3"/><path d="M5 11h14M9 20l-2 1.5M15 20l2 1.5M8.5 14h.01M15.5 14h.01"/>'),
  bus: s('<rect x="4.5" y="3.5" width="15" height="14" rx="2.5"/><path d="M4.5 10.5h15M7 17.5V20M17 17.5V20M8 14h.01M16 14h.01"/>'),
  walk: s('<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 2.5 2.5V21M8 12l2.5-4 3 1 2 3.5M12.5 8.5L11 13"/>'),
  car: s('<path d="M5 16V11.5l1.8-4.5h10.4L19 11.5V16"/><path d="M3.5 16h17M5 11.5h14"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>'),
  clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  lock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  utensils: s('<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2 1.5-3 4-3 7h3"/>'),
  coffee: s('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>'),
  alert: s('<path d="M12 4l9 16H3l9-16Z"/><path d="M12 10v4M12 17.5h.01"/>'),
  phone: s('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  share: s('<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/>'),
  trophy: s('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4"/>'),
  hotel: s('<path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V20M16 10h2.5A1.5 1.5 0 0 1 20 11.5V20M2.5 20h19M8 8h1M11 8h1M8 12h1M11 12h1M9 20v-3.5h2V20"/>'),
  building: s('<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M8.5 7.5h1M14.5 7.5h1M8.5 11.5h1M14.5 11.5h1M10.5 20.5v-4h3v4"/>'),
  pin: s('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  shirt: s('<path d="M8.5 3.5L4 6l1.5 4 2-1V20.5h9V9l2 1L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0Z"/>'),
  sparkle: s('<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>'),
  store: s('<path d="M4 9.5l1.5-5h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8.5h13V12M10 20.5v-5h4v5"/>'),
  landmark: s('<path d="M3.5 9.5L12 4l8.5 5.5M5 9.5h14M6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8M4 20.5h16M5 17.5h14"/>'),
  sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  cloudSun: s('<path d="M7 18.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 7 18.5Z"/><path d="M15.5 4.5v1.2M19.6 6.4l-.9.9M21 10.5h-1.2"/>'),
  cloud: s('<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18.5Z"/>'),
  fog: s('<path d="M4 9h16M3 13h18M5 17h14M8 21h8"/>'),
  rain: s('<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14.5Z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>'),
  snow: s('<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14.5Z"/><path d="M8 18h.01M12 19.5h.01M16 18h.01M10 21.5h.01M14 21.5h.01"/>'),
  storm: s('<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14.5Z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>'),
  wind: s('<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h8"/>'),
  umbrella: s('<path d="M3 12a9 9 0 0 1 18 0H3ZM12 12v6.5a2 2 0 0 0 4 0"/>'),
  search: s('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>'),
  camera: s('<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>'),
  plane: s('<path d="M2.5 13.5l19-8-5.5 15-3.5-6-10-1Z"/><path d="M12.5 14.5l9-9"/>'),
  party: s('<path d="M4 20l4.5-12 7.5 7.5L4 20Z"/><path d="M14 4.5v.01M19 9v.01M17.5 3.5l-1 2M20.5 6.5l-2 1M13.5 9.5c1-2 3-3 5-3"/>'),
};

/** ไอคอนตามหมวดสถานที่ */
export function catIcon(category: string, foodType?: string | null): string {
  if (foodType === 'cafe') return I.coffee;
  return ({ food: I.utensils, fashion: I.shirt, beauty: I.sparkle, market: I.store, sight: I.landmark, base: I.hotel } as Record<string, string>)[category] ?? I.pin;
}

/** ไอคอนสภาพอากาศตามรหัส WMO */
export function wxIcon(code: number | null | undefined): string {
  if (code == null) return I.cloud;
  if (code === 0) return I.sun;
  if (code <= 2) return I.cloudSun;
  if (code === 3) return I.cloud;
  if (code === 45 || code === 48) return I.fog;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return I.snow;
  if (code >= 95) return I.storm;
  if (code >= 51) return I.rain;
  return I.cloud;
}
