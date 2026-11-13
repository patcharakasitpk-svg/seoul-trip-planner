import { test, expect, type Page } from '@playwright/test';

/** จำลอง Open-Meteo: 16 วันเริ่ม 2026-11-13 (เวลาโซล); อุ่นตอนกลางวัน หนาวตอนเย็น */
async function mockWeather(page: Page, calls: string[] = []) {
  await page.route('https://api.open-meteo.com/**', async (route) => {
    calls.push(route.request().url());
    const days: string[] = [];
    for (let i = 0; i < 16; i++) days.push(new Date(Date.UTC(2026, 10, 13 + i)).toISOString().slice(0, 10));
    const time: string[] = [];
    const t: number[] = [], a: number[] = [];
    for (const d of days) for (let h = 0; h < 24; h++) { time.push(`${d}T${String(h).padStart(2, '0')}:00`); const warm = h >= 11 && h <= 15; t.push(warm ? 15 : 1); a.push(warm ? 14 : -4); }
    const z = time.map(() => 0);
    await route.fulfill({ json: {
      utc_offset_seconds: 32400, timezone: 'Asia/Seoul',
      hourly: { time, temperature_2m: t, apparent_temperature: a, precipitation_probability: z.map(() => 10), precipitation: z, snowfall: z.map(() => null), weather_code: z.map(() => 3), wind_speed_10m: z.map(() => 8), wind_gusts_10m: z.map(() => 15) },
      daily: { time: days, weather_code: days.map(() => 3), temperature_2m_max: days.map(() => 15), temperature_2m_min: days.map(() => 1), apparent_temperature_max: days.map(() => 14), apparent_temperature_min: days.map(() => -4), precipitation_probability_max: days.map(() => 10), precipitation_sum: days.map(() => 0), snowfall_sum: days.map(() => null), wind_speed_10m_max: days.map(() => 8) },
    } });
  });
  await page.route('https://maps.googleapis.com/**', (r) => r.abort());
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;
async function gotoPlan(page: Page) {
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="plan"]').click();
}
async function gotoPlaces(page: Page) {
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="places"]').click();
}
async function setDay(page: Page, date: string, time: string, endTime = '22:00') {
  await gotoPlan(page);
  await page.locator('[data-field="date"]').fill(date);
  await page.locator('[data-field="date"]').dispatchEvent('change');
  await page.locator('[data-field="startTime"]').fill(time);
  await page.locator('[data-field="startTime"]').dispatchEvent('change');
  await page.locator('[data-field="endTime"]').fill(endTime);
  await page.locator('[data-field="endTime"]').dispatchEvent('change');
}

test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

test('ไม่มี API key: แผนยังใช้ได้ เพิ่มสถานที่ผ่านหน้าเปรียบเทียบ และกรอกเวลาเองได้', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status-bar')).toContainText('ยังไม่ได้ตั้งค่า Google Maps API Key');
  await setDay(page, '2026-11-20', '18:00');
  // เพิ่ม Starfield Library เข้าวัน 1
  await gotoPlaces(page);
  await page.locator('[data-filter="q"]').fill('Starfield Library');
  await page.locator('[data-place-card="library"] [data-act="add-to-day"]').click();
  await page.locator('[data-act="add-at"]').first().click();
  // แสดงผลก่อนยืนยัน และแผนจริงยังไม่เปลี่ยน
  await expect(page.locator('.modal')).toContainText('แผนเดิม');
  await expect(page.locator('.modal')).toContainText('ยังไม่มีข้อมูลเวลาเดินทาง');
  await page.locator('[data-act="modal-close"]').first().click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).not.toContainText('ห้องสมุดสตาร์ฟิลด์');
  // ทำอีกครั้งแล้วยืนยัน
  await gotoPlaces(page);
  await page.locator('[data-place-card="library"] [data-act="add-to-day"]').click();
  await page.locator('[data-act="add-at"]').first().click();
  await page.locator('[data-act="compare-confirm"]').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('ห้องสมุดสตาร์ฟิลด์');
  // ข้อมูลขาด: แสดง "อย่างเร็ว" และไม่สรุปว่าทัน
  await expect(page.locator('.banner')).toContainText('ยังสรุปไม่ได้ว่าทัน');
  // กรอกเวลาเดินทางเองทุกช่วงที่มีการเคลื่อนที่ (โรงแรม→ห้องสมุด, ห้องสมุด→มื้อเย็น(ยังไม่เลือก), →โรงแรม)
  const manual = page.locator('[data-act-change="leg-manual"]').first();
  await manual.fill('40');
  await manual.dispatchEvent('change');
  await expect(page.locator('.stop').first()).toContainText('ถึง 18:45'); // 40 นาที + เวลาเผื่อ 5 นาที (แยกบรรทัด)
  await expect(page.locator('.leg').first()).toContainText('+ เผื่อ 5 นาที');
  await expect(page.locator('.leg .pill.src.user').first()).toBeVisible();
  // เปลี่ยนเวลาเริ่ม → ตารางเลื่อนตาม
  await page.locator('[data-field="startTime"]').fill('19:00');
  await page.locator('[data-field="startTime"]').dispatchEvent('change');
  await expect(page.locator('.stop').first()).toContainText('ถึง 19:45');
});

test('อากาศจับคู่วันที่เกาหลี เน้นช่วงเย็น และวันนอกช่วงไม่แสดงข้อมูลปลอม', async ({ page }) => {
  await page.goto('/');
  await gotoPlan(page);
  await expect(page.locator('.wx')).toContainText('เลือกวันที่เพื่อดูพยากรณ์อากาศ');
  await setDay(page, '2026-11-20', '18:00', '22:00');
  await expect(page.locator('.wx-window')).toContainText('ช่วงที่ออกเที่ยว 18:00');
  await expect(page.locator('.wx-window')).toContainText('รู้สึกจริง -4° ถึง -4°C');
  await expect(page.locator('.clothes')).toContainText('เสื้อโค้ทหนา');
  await expect(page.locator('.attr').first()).toContainText('Open-Meteo');
  await page.locator('[data-field="date"]').fill('2027-01-15');
  await page.locator('[data-field="date"]').dispatchEvent('change');
  await expect(page.locator('.wx')).toContainText('ยังไม่มีพยากรณ์สำหรับวันนี้ โปรดตรวจอีกครั้งใกล้วันเดินทาง');
  await expect(page.locator('.wx-window')).toHaveCount(0);
});

test('ใช้แคชอากาศ ไม่เรียก API ซ้ำทุกครั้งที่แตะ', async ({ page }) => {
  const calls: string[] = [];
  await page.unroute('https://api.open-meteo.com/**');
  await mockWeather(page, calls);
  await page.goto('/');
  await setDay(page, '2026-11-20', '10:00');
  for (let i = 0; i < 3; i++) await page.locator('[data-act="add-item"][data-kind="break"]').click();
  await expect(page.locator('.wx-window')).toBeVisible();
  expect(calls.length).toBe(1);
  expect(calls[0]).toContain('timezone=Asia%2FSeoul');
});

test('บันทึก โหลดกลับ และส่งแผนผ่านลิงก์ไปเครื่องใหม่', async ({ page, browser }) => {
  await page.goto('/');
  await setDay(page, '2026-11-21', '09:30');
  await page.locator('[data-act="add-item"][data-kind="break"]').click();
  await page.reload();
  await gotoPlan(page);
  await expect(page.locator('[data-field="startTime"]')).toHaveValue('09:30');
  await expect(page.locator('.timeline')).toContainText('พัก');
  await page.locator('[data-act="open-share"]').click();
  const url = await page.locator('#share-url').inputValue();
  expect(url).toContain('#plan=');
  await expect(page.locator('#qr')).toBeVisible();
  // เครื่องใหม่ (ไม่มีแผนเดิม) → เปิดแผนทันที
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx.newPage();
  await mockWeather(p2);
  await p2.goto(url);
  await p2.locator('.bottom-nav [data-tab="plan"]').click();
  await expect(p2.locator('[data-field="startTime"]')).toHaveValue('09:30');
  await expect(p2.locator('[data-field="date"]')).toHaveValue('2026-11-21');
  // เครื่องที่มีแผนเดิม → ถามเปิดเป็นสำเนา/แทนที่
  await p2.goto('/');
  await p2.goto(url);
  await expect(p2.locator('.modal')).toContainText('เปิดเป็นสำเนา');
  await p2.locator('[data-act="import-copy"]').click();
  await expect(p2.locator('#plan-name')).toContainText('(สำเนา)');
  await ctx.close();
});

test('หน้าจอไม่มีเนื้อหาล้นแนวนอน และปุ่มหลักกดได้สะดวก', async ({ page }) => {
  await page.goto('/');
  await setDay(page, '2026-11-20', '18:00');
  const tabs = isMobile(page) ? ['today', 'map', 'places', 'plan'] : ['plan'];
  for (const t of tabs) {
    if (isMobile(page)) await page.locator(`.bottom-nav [data-tab="${t}"]`).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow on ${t}`).toBeLessThanOrEqual(0);
  }
  if (isMobile(page)) {
    const heights = await page.locator('.bottom-nav button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    await page.locator('.bottom-nav [data-tab="plan"]').click();
    const moveBtn = await page.locator('[data-act="stop-down"], [data-act="stop-up"]').first().boundingBox();
    expect(moveBtn!.height).toBeGreaterThanOrEqual(40);
    // modal ไม่ล้น
    await page.locator('[data-act="open-templates"]').click();
    const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(o2).toBeLessThanOrEqual(0);
  } else {
    await expect(page.locator('#library')).toBeVisible();
    await expect(page.locator('#map-panel')).toBeVisible();
    await expect(page.locator('#right')).toBeVisible();
  }
});

test('แม่แบบ: ดูไม่ล้างแผน และต้องยืนยันก่อนแทนที่', async ({ page }) => {
  await page.goto('/');
  await setDay(page, '2026-11-20', '10:00');
  await page.locator('[data-act="add-item"][data-kind="buffer"]').click();
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="B"]').click();
  await page.locator('[data-act="modal-close"]').first().click();
  await expect(page.locator('.timeline')).toContainText('เวลาสำรอง');
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await expect(page.locator('.modal')).toContainText('แทนที่รายการในวัน');
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('ตลาดนัมแดมุน');
  await expect(page.locator('[data-field="startTime"]')).toHaveValue('10:00'); // เวลาที่ผู้ใช้ตั้งยังอยู่
});

test('ลบและย้ายจุดได้โดยไม่ต้องลากวาง', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('ตลาดนัมแดมุน');
  const first = page.locator('.stop .stop-title .t').first();
  const firstText = await first.textContent();
  await page.locator('[data-act="stop-down"]').first().click();
  await expect(page.locator('.stop .stop-title .t').nth(1)).toHaveText(firstText!);
  const count = await page.locator('.stop').count();
  await page.locator('[data-act="toggle-expand"]').first().click();
  await page.locator('[data-act="stop-remove"]').first().click();
  await expect(page.locator('.stop')).toHaveCount(count - 1);
});
