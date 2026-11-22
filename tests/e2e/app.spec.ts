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
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204, body: '' }));
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 1024;
async function gotoPlan(page: Page) {
  await page.locator(isMobile(page) ? '.bottom-nav [data-tab="plan"]' : '.main-menu [data-tab="plan"]').click();
}
async function gotoToday(page: Page) {
  await page.locator('[data-act="tab"][data-tab="today"]').filter({ visible: true }).first().click();
}
/** เปิดตัวจัดแผนของวันที่ i ผ่านปุ่ม "แก้" บนการ์ดวันในหน้าแผนของฉัน */
async function openPlanner(page: Page, i = 0) {
  await gotoPlan(page);
  await page.locator('.ov-day [data-act="edit-day"]').nth(i).click();
  await expect(page.locator('#planner')).toBeVisible();
}
/** ตั้งวันที่/เวลาของวันแรกในตัวจัดแผน แล้วยืนยัน */
async function setDay(page: Page, date: string, time: string, endTime = '22:00') {
  await openPlanner(page);
  const pl = page.locator('#planner');
  for (const [k, v] of [['date', date], ['startTime', time], ['endTime', endTime]]) {
    await pl.locator(`[data-pl-change="${k}"]`).fill(v);
    await pl.locator(`[data-pl-change="${k}"]`).dispatchEvent('change');
  }
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await pl.locator('[data-pl="confirm"]').click();
  await expect(pl).toBeHidden();
}
/** ตั้งเวลาอยู่ในตัวจัดแผน (ช่องชั่วโมง + นาที) */
async function setStay(row: import('@playwright/test').Locator, h: number, m: number) {
  await row.locator('[data-pl-change="stay-h"]').fill(String(h));
  await row.locator('[data-pl-change="stay-m"]').fill(String(m));
  await row.locator('[data-pl-change="stay-m"]').dispatchEvent('change');
}
/** แผนแนะนำ (แม่แบบ) อยู่ในหน้าต่างตั้งค่า */
async function openTemplates(page: Page) {
  await page.locator('[data-act="open-settings"]').click();
  await page.locator('.modal [data-act="open-templates"]').click();
}
/** ใช้แผนแนะนำทั้งทริป (แม่แบบ T) */
async function applyTripTemplate(page: Page) {
  await openTemplates(page);
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
}

test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

test('ไม่มี API key: ใช้แผนที่ OpenStreetMap · ตั้งวันในตัวจัดแผนแล้วหน้าแผนของฉันแสดงตาม', async ({ page }) => {
  await page.goto('/');
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="map"]').click();
  await expect(page.locator('#map .leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await setDay(page, '2026-11-20', '18:00');
  await expect(page.locator('#toast')).toContainText('บันทึกแผนวันนี้แล้ว');
  await expect(page.locator('body')).toHaveAttribute('data-tab', 'plan');
  const d1 = page.locator('.ov-day').first();
  await expect(d1.locator('.ov-date b')).toHaveText('ศ. 20 พ.ย.'); // วันที่จริงเด่นกว่า "วัน 1"
  await expect(d1).toContainText('18:00–22:00');
});

test('หน้าแผนของฉัน: ดูอย่างเดียว ทุกวันเรียงกัน สีประจำวัน วันที่จริงเด่น · แตะวันที่ = ดูวันนั้นบนแผนที่ · แก้ = เปิดตัวจัดแผน', async ({ page }) => {
  await page.goto('/');
  await applyTripTemplate(page);
  await gotoPlan(page);
  const days = page.locator('.ov-day');
  await expect(days).toHaveCount(7);
  await expect(days.nth(0).locator('.ov-date b')).toHaveText('จ. 30 พ.ย.');
  await expect(days.nth(1).locator('.ov-date b')).toHaveText('อ. 1 ธ.ค.');
  // สีวันแรกเขียว วันที่สองเหลือง
  await expect(days.nth(0).locator('.ov-date b')).toHaveCSS('color', 'rgb(22, 163, 74)');
  await expect(days.nth(1).locator('.ov-date b')).toHaveCSS('color', 'rgb(202, 138, 4)');
  await expect(days.nth(0)).toContainText('Myeongdong Kyoja');
  await expect(days.nth(0).locator('.ov-meal').first()).toBeVisible();
  // ไม่มีเครื่องมือแก้/ค้นหาในหน้านี้
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#right [data-act="add-item"], #right [data-act="stop-info"], #right [data-filter="q"]')).toHaveCount(0);
  // แตะวันที่บนการ์ด → แผนที่แสดงเฉพาะวันนั้น
  await days.nth(1).locator('.ov-date').click();
  await expect(days.nth(1)).toHaveClass(/sel/);
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="map"]').click();
  await expect(page.locator('.date-chip.on')).toHaveText('อ. 1 ธ.ค.');
  await page.locator('.date-chip.all').click();
  await expect(page.locator('.date-chip.all')).toHaveClass(/on/);
  // แก้ → ตัวจัดแผนของวันนั้น (หัวเป็นวันที่จริง)
  await openPlanner(page, 1);
  await expect(page.locator('#planner .pl-title')).toContainText('1 ธ.ค. 2026');
});

test('อากาศในหน้า วันนี้: จับคู่วันที่เกาหลี เน้นช่วงที่ออกเที่ยว · วันนอกช่วงไม่แสดงข้อมูลปลอม', async ({ page }) => {
  await page.goto('/');
  await gotoToday(page);
  // แผนใหม่มีวันที่ทริป (30 พ.ย.) ซึ่งเกินช่วงพยากรณ์ของข้อมูลจำลอง → ไม่แสดงตัวเลข
  await expect(page.locator('.wx')).toContainText('ยังไม่มีพยากรณ์สำหรับวันนี้');
  await setDay(page, '2026-11-20', '18:00', '22:00');
  await gotoToday(page);
  await page.locator('[data-act-change="today-day"]').selectOption({ index: 0 });
  await expect(page.locator('.wx-window')).toContainText('ช่วงที่ออกเที่ยว 18:00');
  await expect(page.locator('.wx-window')).toContainText('รู้สึกจริง -4° ถึง -4°C');
  await expect(page.locator('.attr').first()).toContainText('Open-Meteo');
  await setDay(page, '2027-01-15', '18:00', '22:00');
  await gotoToday(page);
  await expect(page.locator('.wx')).toContainText('ยังไม่มีพยากรณ์สำหรับวันนี้ โปรดตรวจอีกครั้งใกล้วันเดินทาง');
  await expect(page.locator('.wx-window')).toHaveCount(0);
});

test('ใช้แคชอากาศ ไม่เรียก API ซ้ำทุกครั้งที่แตะ', async ({ page }) => {
  const calls: string[] = [];
  await page.unroute('https://api.open-meteo.com/**');
  await mockWeather(page, calls);
  await page.goto('/');
  await setDay(page, '2026-11-20', '10:00');
  for (let i = 0; i < 3; i++) {
    await gotoToday(page);
    await gotoPlan(page);
  }
  await gotoToday(page);
  await expect(page.locator('.wx-window')).toBeVisible();
  expect(calls.length).toBe(1);
  expect(calls[0]).toContain('timezone=Asia%2FSeoul');
});

test('บันทึก โหลดกลับ และส่งแผนผ่านลิงก์ไปเครื่องใหม่', async ({ page, browser }) => {
  await page.goto('/');
  await setDay(page, '2026-11-21', '09:30');
  await page.reload();
  await gotoPlan(page);
  await expect(page.locator('.ov-day').first()).toContainText('09:30');
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
  await expect(p2.locator('.ov-day').first()).toContainText('09:30');
  await expect(p2.locator('.ov-day').first().locator('.ov-date b')).toHaveText('ส. 21 พ.ย.');
  // เครื่องที่มีแผนเดิม → ถามเก็บแยก/ใช้แผนนี้
  await p2.goto('/');
  await p2.goto(url);
  await expect(p2.locator('.modal')).toContainText('ฉบับใหม่ของแผนที่มีในเครื่องนี้');
  await p2.locator('[data-act="import-copy"]').click();
  await expect(p2.locator('#plan-name')).toContainText('(สำเนา)');
  // ส่งแผนที่แก้แล้วมาอีกครั้ง → ใช้แผนนี้ในเครื่องนี้ (แทนที่) แล้วไปหน้า วันนี้
  await p2.goto('/');
  await p2.goto(url);
  await p2.locator('[data-act="import-replace"]').click();
  await expect(p2.locator('.modal')).toHaveCount(0);
  await expect(p2.locator('.toast')).toContainText('ใช้แผนใหม่ในเครื่องนี้แล้ว');
  await p2.locator('.bottom-nav [data-tab="plan"]').click();
  await expect(p2.locator('.ov-day').first()).toContainText('09:30');
  await ctx.close();
});

test('หน้าจอไม่มีเนื้อหาล้นแนวนอน และปุ่มหลักกดได้สะดวก', async ({ page }) => {
  await page.goto('/');
  await applyTripTemplate(page);
  const tabs = isMobile(page) ? ['today', 'map', 'plan'] : ['plan', 'today'];
  for (const t of tabs) {
    await page.locator(`[data-act="tab"][data-tab="${t}"]`).filter({ visible: true }).first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow on ${t}`).toBeLessThanOrEqual(0);
  }
  if (isMobile(page)) {
    // ปุ่ม "จัดแผน" ซ่อนบนมือถือ (ใช้บนคอม/iPad) · ไม่มีแท็บค้นหาสถานที่แล้ว
    await expect(page.locator('.bottom-nav .nav-planner')).toBeHidden();
    await expect(page.locator('.bottom-nav [data-tab="places"]')).toHaveCount(1); // แท็บ สถานที่ของฉัน (ไม่ใช่หน้าค้นหาเดิม)
    const heights = await page.locator('.bottom-nav button:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    await openTemplates(page);
    const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(o2).toBeLessThanOrEqual(0);
  } else {
    await gotoPlan(page);
    await expect(page.locator('#library')).toBeHidden();
    await expect(page.locator('#map-panel')).toBeVisible();
    await expect(page.locator('#right')).toBeVisible();
  }
});

test('แม่แบบ: ดูไม่ล้างแผน และต้องยืนยันก่อนแทนที่', async ({ page }) => {
  await page.goto('/');
  await setDay(page, '2026-11-20', '10:00');
  await expect(page.locator('.ov-day').first()).toContainText('10:00–22:00');
  const before = await page.locator('.ov-day').first().innerText();
  await openTemplates(page);
  await page.locator('[data-act="tpl-tab"][data-v="B"]').click();
  await page.locator('[data-act="modal-close"]').first().click();
  expect(await page.locator('.ov-day').first().innerText()).toBe(before);
  await openTemplates(page);
  await page.locator('[data-act="tpl-tab"][data-v="A"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await expect(page.locator('.modal')).toContainText('แทนที่รายการในวัน');
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await expect(page.locator('.ov-day').first()).toContainText('Namdaemun Market');
  await expect(page.locator('.ov-day').first()).toContainText('10:00–'); // เวลาที่ผู้ใช้ตั้งยังอยู่
});

test('เลือกแผนรายวัน: ใช้การ์ดกับวันที่เลือก นัดที่ล็อกยังอยู่ และเติมที่ใกล้เคียงเองได้', async ({ page }) => {
  await page.goto('/');
  // พฤ. 3 ธ.ค. มีนัด COEX ที่ล็อกไว้จากแผนแนะนำ
  await applyTripTemplate(page);
  await openTemplates(page);
  await expect(page.locator('.modal')).toContainText('เลือกแผนรายวัน');
  const card = page.locator('.tpl-day', { hasText: 'ฮงแด ช็อปตอนเย็น' });
  const day4 = await card.locator('[data-act-change="tpl-target"] option').nth(3).getAttribute('value');
  await card.locator('[data-act-change="tpl-target"]').selectOption(day4!);
  await page.locator('.tpl-day', { hasText: 'ฮงแด ช็อปตอนเย็น' }).locator('[data-act="tpl-copy-day"][data-mode="replace"]').click();
  await expect(page.locator('#toast')).toContainText('เป็น พฤ. 3 ธ.ค.');
  await gotoPlan(page);
  await expect(page.locator('.ov-day').nth(3)).toContainText('COEX'); // นัดที่ล็อกยังอยู่
  await expect(page.locator('.ov-day').nth(3)).toContainText('Jangin Dakgalbi');
  // เติมที่ใกล้เคียงเองจากการ์ด
  await openTemplates(page);
  const c2 = page.locator('.tpl-day', { hasText: 'วันมาถึง' });
  const nearBtn = c2.locator('.tpl-near [data-act="tpl-add-place"]').first();
  await nearBtn.click();
  await expect(page.locator('#toast')).toContainText('เพิ่ม');
  await expect(page.locator('.tpl-day', { hasText: 'วันมาถึง' }).locator('.tpl-near [data-act="tpl-add-place"]').first()).toHaveAttribute('aria-pressed', 'true');
});

test('แปลงเงิน: พิมพ์วอนเห็นบาททันที ใช้ปุ่มลัด สลับทิศ และตั้งอัตราเองได้ (ออฟไลน์ใช้อัตราที่จำไว้)', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { amount: 1, base: 'THB', date: '2026-11-13', rates: { KRW: 40 } } }));
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await expect(page.locator('.fx-rate')).toContainText('1 บาท = 40.00 วอน');
  await page.locator('#fx-in').pressSequentially('12500');
  await expect(page.locator('#fx-in')).toHaveValue('12,500');
  await expect(page.locator('#fx-out')).toHaveText('313');
  await expect(page.locator('#fx-in')).toBeFocused(); // พิมพ์ต่อได้ แป้นไม่หุบ
  await page.locator('[data-act="fx-set"][data-v="50000"]').click();
  await expect(page.locator('#fx-out')).toHaveText('1,250');
  await page.locator('[data-act="fx-swap"]').click();
  await expect(page.locator('#fx-in')).toHaveValue('1,250');
  await expect(page.locator('#fx-out')).toHaveText('50,000');
  await page.locator('[data-act="fx-swap"]').click();
  await page.locator('[data-act="fx-edit"]').click();
  await page.locator('[name="rate"]').fill('38');
  await page.locator('.fx-rate-form button.primary').click();
  await page.locator('[data-act="fx-set"][data-v="10000"]').click();
  await expect(page.locator('#fx-out')).toHaveText('263');
  await expect(page.locator('.fx-rate')).toContainText('อัตราที่ตั้งเอง');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('ของที่จะซื้อ: เพิ่ม/เทียบราคา/แก้/ลบ/เลิกทำ', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { amount: 1, base: 'THB', date: '2026-11-13', rates: { KRW: 40 } } }));
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await page.locator('[data-act="money-view"][data-v="shop"]').click();
  // เพิ่มของ
  await page.locator('[data-act="shop-add"]').click();
  const f = page.locator('form[data-form="shop-item"]');
  await expect(f.locator('[name="name"]')).toBeFocused();
  await f.locator('[name="name"]').fill('กันแดด');
  await f.locator('[name="thb"]').fill('580');
  await f.locator('[name="qty"]').fill('2');
  await f.locator('[name="name"]').press('Enter');
  const card = page.locator('[data-shop-item]', { hasText: 'กันแดด' });
  await expect(card).toBeVisible();
  // ราคาร้านในเกาหลี
  for (const [store, krw] of [['Olive Young', '18000'], ['Daiso', '21000']]) {
    await card.locator('[data-act="shop-price-add"]').click();
    const pf = page.locator('form[data-form="shop-price"]');
    await pf.locator('[name="store"]').fill(store);
    await pf.locator('[name="krw"]').fill(krw);
    await pf.locator('[name="krw"]').press('Enter');
  }
  await expect(card.locator('.shop-price.best')).toContainText('Olive Young');
  await expect(card).toContainText('ถูกกว่าไทย ฿130/ชิ้น');
  await expect(card).toContainText('2 ชิ้นประหยัด ฿260');
  // ร้านล่าสุดถูกเติมให้อัตโนมัติ
  await card.locator('[data-act="shop-price-add"]').click();
  await expect(page.locator('form[data-form="shop-price"] [name="store"]')).toHaveValue('Daiso');
  await page.locator('form[data-form="shop-price"] [data-act="shop-form-cancel"]').click();
  // แก้ราคา Daiso → ถูกสุดย้าย
  await card.locator('[data-act="shop-price-edit"]', { hasText: 'Daiso' }).click();
  await page.locator('form[data-form="shop-price"] [name="krw"]').fill('15000');
  await page.locator('form[data-form="shop-price"] [name="krw"]').press('Enter');
  await expect(card.locator('.shop-price.best')).toContainText('Daiso');
  // ลบ + เลิกทำ
  await card.locator('[data-act="shop-del"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'กันแดด' })).toHaveCount(0);
  await page.locator('[data-act="toast-undo"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'กันแดด' })).toBeVisible();
  // เก็บในเครื่อง: รีโหลดแล้วยังอยู่
  await page.reload();
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await page.locator('[data-act="money-view"][data-v="shop"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'กันแดด' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('ของที่จะซื้อ: สิ่งที่กำลังพิมพ์ไม่หายเมื่อเน็ตหลุด · ราคาผิดมีคำเตือน · เลิกทำไม่ทับการแก้อื่น', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { amount: 1, base: 'THB', date: '2026-11-13', rates: { KRW: 40 } } }));
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await page.locator('[data-act="money-view"][data-v="shop"]').click();
  for (const name of ['A', 'B']) {
    await page.locator('[data-act="shop-add"]').click();
    await page.locator('form[data-form="shop-item"] [name="name"]').fill(name);
    await page.locator('form[data-form="shop-item"] [name="name"]').press('Enter');
  }
  // พิมพ์ค้างอยู่ แล้วเน็ตหลุด/กลับมา (หน้าเรนเดอร์ใหม่)
  await page.locator('[data-shop-item]', { hasText: 'A' }).locator('[data-act="shop-price-add"]').click();
  const pf = page.locator('form[data-form="shop-price"]');
  await pf.locator('[name="store"]').fill('Daiso');
  await pf.locator('[name="krw"]').fill('18');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('#status-bar')).toContainText('ออฟไลน์'); // หน้าเรนเดอร์ใหม่แล้ว
  await expect(page.locator('form[data-form="shop-price"] [name="store"]')).toHaveValue('Daiso');
  await expect(page.locator('form[data-form="shop-price"] [name="krw"]')).toHaveValue('18');
  await expect(page.locator('form[data-form="shop-price"] [name="krw"]')).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // ราคาผิด → มีคำเตือน
  await page.locator('form[data-form="shop-price"] [name="krw"]').fill('abc');
  await page.locator('form[data-form="shop-price"] [name="krw"]').press('Enter');
  await expect(page.locator('#toast')).toContainText('ใส่ราคาวอน');
  await page.locator('form[data-form="shop-price"] [data-act="shop-form-cancel"]').click();
  // ลบ A → ติ๊ก B ซื้อแล้ว → เลิกทำ: A กลับมา และ B ยังติ๊กอยู่
  await page.locator('[data-shop-item]', { hasText: 'A' }).locator('[data-act="shop-del"]').click();
  await page.locator('[data-shop-item]', { hasText: 'B' }).locator('[data-act="shop-bought"]').click();
  await page.locator('[data-act="toast-undo"]').click().catch(() => {});
  // toast ของการติ๊กไม่มีปุ่มเลิกทำ → ปุ่มเลิกทำของการลบต้องยังกดได้
  await expect(page.locator('[data-shop-item]', { hasText: 'A' })).toBeVisible();
  await expect(page.locator('[data-shop-item]', { hasText: 'B' }).locator('[data-act="shop-bought"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Naver Map: ปุ่มเส้นทางรถเมล์/รถไฟ (โลโก้) และคำแนะนำเมื่อเปิดแอปไม่ได้', async ({ page }) => {
  await page.goto('/');
  await applyTripTemplate(page);
  await gotoToday(page);
  const btn = page.locator('.hero [data-act="naver"]').first();
  await expect(btn).toBeVisible();
  await expect(btn.locator('img.app-logo')).toBeVisible();
  expect(await btn.getAttribute('data-href')).toMatch(/^nmap:\/\/route\/public\?.*dlat=/);
  await btn.click(); // ไม่มีแอป → ยังอยู่หน้าเดิม → แนะนำติดตั้ง
  await expect(page.locator('.modal')).toContainText('Naver Map', { timeout: 6000 });
});

test('ของที่จะซื้อ: เลือกรูปแล้วเห็นตัวอย่างก่อนบันทึก · ยกเลิกไม่ใช้รูป · ดูรูปใหญ่ · เก็บหลังรีโหลด · ลบรูปต้องกดบันทึก', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await page.locator('[data-act="money-view"][data-v="shop"]').click();
  const makePng = (color: string) =>
    page.evaluate(async (col) => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 800;
      const x = c.getContext('2d')!; x.fillStyle = col; x.fillRect(0, 0, 1200, 800);
      const b: Blob = await new Promise((r) => c.toBlob((bb) => r(bb!), 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }, color);
  const file = async (color: string) => ({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(await makePng(color)) });

  // เพิ่มของใหม่พร้อมรูป: เห็นตัวอย่างในฟอร์มก่อนกดเพิ่ม
  await page.locator('[data-act="shop-add"]').click();
  const f = page.locator('form[data-form="shop-item"]');
  await f.locator('[name="name"]').fill('มาสก์หน้า');
  await f.locator('input[type="file"][data-shop-photo]').setInputFiles(await file('#e8453c'));
  const preview = page.locator('form[data-form="shop-item"] .photo-preview img');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  expect(await preview.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640); // ย่อแล้ว
  await expect(page.locator('form[data-form="shop-item"] [name="name"]')).toHaveValue('มาสก์หน้า'); // ที่พิมพ์ไว้ไม่หาย
  await page.locator('form[data-form="shop-item"] button.primary').click();
  const card = page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' });
  await expect(card.locator('.shop-thumb img')).toHaveAttribute('src', /^blob:/);

  // กรอบ 📷 ของการ์ดที่ยังไม่มีรูป → เปิดฟอร์มพร้อมตัวอย่าง · กดยกเลิก = ไม่ใช้รูป
  await page.locator('[data-act="shop-add"]').click();
  await page.locator('form[data-form="shop-item"] [name="name"]').fill('กันแดด');
  await page.locator('form[data-form="shop-item"] [name="name"]').press('Enter');
  const c2 = page.locator('[data-shop-item]', { hasText: 'กันแดด' });
  await c2.locator('.shop-thumb.add input[data-shop-photo]').setInputFiles(await file('#4aa3df'));
  await expect(page.locator('form[data-form="shop-item"] .photo-preview img')).toHaveAttribute('src', /^blob:/);
  await page.locator('form[data-form="shop-item"] [data-act="shop-form-cancel"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'กันแดด' }).locator('.shop-thumb.add')).toBeVisible();

  // ดูรูปใหญ่
  await card.locator('[data-act="shop-photo-view"]').click();
  await expect(page.locator('.photo-view img')).toHaveAttribute('src', /^blob:/);
  await page.locator('.photo-view').click();
  await expect(page.locator('.photo-view')).toHaveCount(0);

  // เก็บหลังรีโหลด
  await page.reload();
  await page.locator('[data-act="tab"][data-tab="fx"]').filter({ visible: true }).first().click();
  await page.locator('[data-act="money-view"][data-v="shop"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' }).locator('.shop-thumb img')).toHaveAttribute('src', /^blob:/);

  // ลบรูป: เห็นว่าจะหายก่อน · ยกเลิก = รูปยังอยู่ · บันทึก = หาย
  await page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' }).locator('[data-act="shop-edit"]').first().click();
  await expect(page.locator('form[data-form="shop-item"] .photo-preview img')).toHaveAttribute('src', /^blob:/); // รูปปัจจุบัน
  await page.locator('[data-act="shop-draft-clear"]').click();
  await expect(page.locator('form[data-form="shop-item"] .photo-preview')).toContainText('ไม่มีรูป');
  await page.locator('form[data-form="shop-item"] [data-act="shop-form-cancel"]').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' }).locator('.shop-thumb img')).toHaveAttribute('src', /^blob:/);
  await page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' }).locator('[data-act="shop-edit"]').first().click();
  await page.locator('[data-act="shop-draft-clear"]').click();
  await page.locator('form[data-form="shop-item"] button.primary').click();
  await expect(page.locator('[data-shop-item]', { hasText: 'มาสก์หน้า' }).locator('.shop-thumb.add')).toBeVisible();
});

test('วันนี้ระหว่างเดินทาง: เริ่มวัน → ถึงแล้ว → อยู่ได้อีก → ออกแล้ว → เวลาที่เหลือคำนวณใหม่ · เลิกทำได้', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-01T01:00:00Z')); // 10:00 เวลาโซล วันที่ 1 ธ.ค.
  await page.goto('/');
  await applyTripTemplate(page);
  await gotoToday(page);
  const hero = page.locator('.hero');
  await expect(page.locator('.today-head')).toContainText('ตอนนี้ 10:00');
  await expect(hero).toContainText('เริ่มวัน');
  await expect(hero).toContainText('ช้ากว่าแผน'); // แผนออก 08:30
  await page.locator('[data-act="live-start"]').click();
  await expect(page.locator('#toast')).toContainText('ออกเดินทาง 10:00');
  await expect(hero).toContainText('กำลังไป');
  await expect(hero).toContainText('Gwangjang Market');
  await expect(hero).toContainText('เดินทาง'); // มีเวลาเดินทาง (≈ ประมาณ)
  await expect(hero.locator('[data-act="naver"]')).toBeVisible();
  await page.locator('[data-act="live-arrive"]').click();
  await expect(hero).toContainText('ตอนนี้อยู่ที่');
  await expect(hero).toContainText('อยู่ได้อีก');
  await expect(hero.locator('.hero-next')).toContainText('Soha Salt Pond'); // ถัดไป
  // timeline: ออกจากโรงแรม ✓ และจุดปัจจุบัน
  await expect(page.locator('.tl.done').first()).toContainText('ออกจาก');
  await expect(page.locator('.tl.now')).toContainText('Gwangjang Market');
  // เลิกทำการเช็กอินล่าสุด
  await page.locator('[data-act="toast-undo"]').click();
  await expect(hero).toContainText('กำลังไป');
  await page.locator('[data-act="live-arrive"]').click();
  await page.locator('[data-act="live-depart"]').click();
  await expect(hero).toContainText('กำลังไป');
  await expect(hero).toContainText('Soha Salt Pond');
  // วันอื่น = ดูล่วงหน้า ไม่มีปุ่มเช็กอิน
  await page.locator('[data-act-change="today-day"]').selectOption({ index: 2 });
  await expect(page.locator('.today-head')).toContainText('ดูล่วงหน้า');
  await expect(page.locator('[data-act^="live-"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('วันนี้: กดชื่อสถานที่ → แผ่นรายละเอียด (ข้อมูลร้าน · สถานี · ปุ่มแผนที่) อ่านอย่างเดียว ปิดได้', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-01T01:00:00Z'));
  await page.goto('/');
  await applyTripTemplate(page);
  await gotoToday(page);
  await page.locator('[data-act="live-start"]').click();
  const hero = page.locator('.hero');
  await hero.locator('h2 .pname').click();
  const sheet = page.locator('.modal.sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.modal-head h2')).toContainText('Gwangjang Market');
  await expect(sheet.locator('.psheet-meta')).toBeVisible();
  await expect(sheet.locator('.psheet-text')).not.toBeEmpty();
  await expect(sheet.locator('.psheet-nav [data-act="naver"]')).toBeVisible();
  await expect(sheet.locator('.psheet-nav a.google')).toHaveAttribute('href', /google\.com\/maps/);
  // อ่านอย่างเดียว: ไม่มีปุ่มเพิ่ม/เอาออกจากวัน
  await expect(sheet.locator('[data-act="quick-toggle"]')).toHaveCount(0);
  await sheet.locator('[data-act="modal-close"]').click();
  await expect(sheet).toHaveCount(0);
  // ชื่อในรายการทั้งวันก็กดได้ · โรงแรมไม่ใช่ปุ่ม
  await page.locator('.tl-list .pname', { hasText: 'Soha Salt Pond' }).click();
  await expect(page.locator('.modal.sheet .modal-head h2')).toContainText('Soha Salt Pond');
  await page.locator('[data-act="modal-close"]').click();
  await expect(page.locator('.tl-list .tl').first().locator('.pname')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('จัดแผนแบบขั้นตอน (คอม/iPad): ตั้งวัน → เลือกสถานที่ → เดินทาง → สรุป → ยืนยัน · ปุ่มคืนค่า ↺', async ({ page }) => {
  test.skip(isMobile(page), 'ออกแบบให้จัดแผนบนคอม/iPad');
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await expect(pl).toBeVisible();
  // ขั้น 1: เปลี่ยนเวลา แล้วกด ↺ กลับค่าที่ระบบตั้งไว้ (วันแรก = ออกจากสนามบิน 08:00)
  await pl.locator('[data-pl-change="startTime"]').fill('10:30');
  await pl.locator('[data-pl-change="startTime"]').dispatchEvent('change');
  await pl.locator('[data-pl="reset-field"][data-v="startTime"]').click();
  await expect(pl.locator('[data-pl-change="startTime"]')).toHaveValue('08:00');
  await expect(pl.locator('.pl-hours')).toContainText('วันนี้มีเวลา');
  // ไม่มีแถบปุ่มด้านล่าง — เปลี่ยนขั้นด้วยแถบขั้นตอนด้านบน
  await expect(pl.locator('.pl-foot')).toHaveCount(0);
  // ขั้น 2: ค้นหาทั้งหมดมีสถานที่หลัก · ใส่โรงแรมและร้าน · เปลี่ยนเวลาอยู่แล้ว ↺
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="clear-stops"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  // ตัวกรองหมวด "จุดหลัก" → มีโรงแรม/COEX/สนามบิน
  await pl.locator('[data-pl="cat"][data-v="base"]').click();
  await expect(pl.locator('.pl-lane-list')).toContainText('Sotetsu');
  await expect(pl.locator('.pl-lane-list')).not.toContainText('Gwangjang Market');
  await pl.locator('[data-pl="cat"][data-v=""]').click();
  // กรองย่าน → เหลือหัวข้อย่านเดียว
  await pl.locator('[data-pl-change="zone"]').selectOption('hongdae');
  await expect(pl.locator('.pl-group').first()).toContainText('ฮงแด');
  await expect(pl.locator('.pl-lane-list')).not.toContainText('Gwangjang Market');
  await pl.locator('[data-pl-change="zone"]').selectOption('');
  await pl.locator('[data-pl="add"][data-place="hotel"]').click();
  await pl.locator('[data-pl-input="q"]').fill('กวางจัง');
  // แตะชื่อ = ดูหมุดแดงก่อน (ยังไม่ใส่) พร้อมระยะจากจุดก่อนหน้า
  await pl.locator('[data-pl="preview"][data-place="gwangjang"]').click();
  await expect(pl.locator('.pl-pin.preview')).toContainText('Gwangjang Market');
  await expect(pl.locator('.pl-item.preview .pl-preview-info')).toContainText('ห่างจาก');
  await expect(pl.locator('.pl-row.stop', { hasText: 'Gwangjang Market' })).toHaveCount(0);
  await pl.locator('[data-pl="add"][data-place="gwangjang"]').click();
  await expect(pl.locator('.pl-pin.preview')).toHaveCount(0);
  // ชื่อสถานที่มีลิงก์ดูรูป (เปิด Google รูปภาพ)
  await expect(pl.locator('.pl-row.stop', { hasText: 'Gwangjang Market' }).locator('a.pl-name')).toHaveAttribute('href', /google\.com\/search\?tbm=isch/);
  // เลขลำดับในช่องเวลา = เลขบนหมุดแผนที่
  const nums = await pl.locator('.pl-row.stop .pl-num').allInnerTexts();
  expect(nums.slice(0, 2)).toEqual(['1', '2']);
  await expect(pl.locator('.pl-pin span', { hasText: '2' }).first()).toBeVisible();
  // ใส่สถานที่เดิมซ้ำได้ (เช่นแวะกลับโรงแรม) · หมุดเดียวบอกหลายลำดับ
  await pl.locator('[data-pl-input="q"]').fill('');
  await pl.locator('[data-pl-input="q"]').dispatchEvent('input');
  await expect(pl.locator('.pl-item', { hasText: 'Sotetsu' }).first()).toContainText('อยู่ในแผนแล้ว');
  await pl.locator('[data-pl="add"][data-place="hotel"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Sotetsu' })).toHaveCount(2);
  await expect(pl.locator('.pl-pin span', { hasText: ',' }).first()).toBeVisible();
  await pl.locator('.pl-row.stop', { hasText: 'Sotetsu' }).last().locator('[data-pl="remove"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Sotetsu' })).toHaveCount(1);
  // หลังใส่ตลาดกวางจัง (จุดสุดท้าย) → กลุ่ม "ใกล้ Gwangjang Market" มีร้านในระยะเดิน
  await pl.locator('[data-pl-input="q"]').fill('');
  await pl.locator('[data-pl-input="q"]').dispatchEvent('input');
  await expect(pl.locator('.pl-group.near')).toContainText('ใกล้ Gwangjang Market');
  await expect(pl.locator('.pl-lane-list')).toContainText('Soha Salt Pond');
  const row = pl.locator('.pl-row.stop', { hasText: 'Gwangjang Market' });
  await expect(row).toBeVisible();
  await setStay(row, 2, 0);
  await row.locator('[data-pl="reset-stay"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Gwangjang Market' }).locator('[data-pl="reset-stay"]')).toHaveCount(0);
  await expect(pl.locator('.pl-budget-range')).toContainText('08:00 – 21:00');
  await expect(pl.locator('.pl-budget-free')).toContainText(/เหลือ|เกินเวลา/);
  // ช่วงเดินทางบอกวิธี + เวลา + ระยะ
  await expect(pl.locator('.pl-travel').first()).toContainText(/(เดิน|รถไฟฟ้า\/รถเมล์|แท็กซี่).*นาที.*ห่าง/);
  await expect(pl.locator('[data-pl="map-fit"]')).toBeVisible();
  // ขั้น 3: แก้เวลาเดินทาง แล้ว ↺
  await pl.locator('.pl-steps [data-pl="goto"][data-v="3"]').click();
  const t = pl.locator('[data-pl-change="travel"]').first();
  await t.fill('70');
  await t.dispatchEvent('change');
  await expect(pl.locator('[data-pl="reset-leg"]').first()).toBeVisible();
  await pl.locator('[data-pl="reset-step"][data-v="3"]').click();
  await expect(pl.locator('[data-pl="reset-leg"]')).toHaveCount(0);
  // ขั้น 4: สรุป · แก้ → กลับขั้น 2 → กลับหน้าสรุป · ยืนยัน → ไปหน้า วันนี้
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await expect(pl.locator('.pl-sum')).toContainText('Gwangjang Market');
  await pl.locator('[data-pl="edit"][data-v="2"]').first().click();
  await expect(pl.locator('.pl-steps li.on')).toContainText('เลือกสถานที่');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await pl.locator('[data-pl="confirm"]').click();
  await expect(pl).toBeHidden();
  await expect(page.locator('#toast')).toContainText('บันทึกแผนวันนี้แล้ว');
  await expect(page.locator('body')).toHaveAttribute('data-tab', 'plan');
  await expect(page.locator('.ov-day').first()).toContainText('Gwangjang Market');
  await expect(page.locator('.ov-day').first()).toHaveClass(/sel/); // เห็นวันนั้นบนแผนที่
});

test('จัดแผนแบบขั้นตอน: ค้นไม่เจอในรายการ → ค้นหาบนแผนที่แล้วใส่ลงแผนได้', async ({ page }) => {
  test.skip(isMobile(page), 'ออกแบบให้จัดแผนบนคอม/iPad');
  await page.route('https://nominatim.openstreetmap.org/**', (r) =>
    r.fulfill({ json: [{ lat: '37.5236', lon: '127.0230', name: 'Test Select Shop', display_name: 'Test Select Shop, Sinsa-dong, Gangnam-gu, Seoul', category: 'shop', type: 'clothes' }] }),
  );
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('test select');
  await expect(pl.locator('.pl-lane-list')).toContainText('ไม่พบในรายการที่เตรียมไว้');
  await pl.locator('[data-pl="web-search"]').click();
  await expect(pl.locator('.pl-web:not(.pl-own-wrap)')).toContainText('Test Select Shop');
  await pl.locator('[data-pl="web-add"][data-v="0"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Test Select Shop' })).toBeVisible();
  // musinsa: ร้านที่ไม่มีพิกัดก็ขึ้นในผลค้นหา
  await pl.locator('[data-pl-input="q"]').fill('musinsa');
  await pl.locator('[data-pl-input="q"]').dispatchEvent('input');
  await expect(pl.locator('.pl-lane-list')).toContainText('MUSINSA STANDARD Myeongdong Jungang');
  expect(await pl.locator('.pl-lane-list .pl-item').count()).toBeGreaterThanOrEqual(4);
});

test('โน้ต "จะไปทำอะไร": เพิ่ม/บันทึก/แก้ ในตัวจัดแผน · แสดงในหน้าแผนของฉันและหน้า วันนี้', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.clock.setFixedTime(new Date('2026-11-30T01:00:00Z')); // 10:00 โซล วันที่ 30 พ.ย.
  await page.goto('/');
  await openTemplates(page);
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  const row = pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' });
  // ร้านอาหาร: เลือกมื้อได้ (กลางวัน) → ป้ายมื้อข้างชื่อ · กดซ้ำ = ยกเลิก
  const mealSel = () => pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' }).locator('[data-pl-change="meal"]');
  await mealSel().selectOption('lunch');
  await expect(mealSel()).toHaveValue('lunch');
  await mealSel().selectOption('');
  await expect(mealSel()).toHaveValue('');
  await mealSel().selectOption('lunch');
  await row.locator('[data-pl="note-edit"]').click();
  await row.locator('textarea').fill('กินคัลกุกซุ + เกี๊ยว สั่ง 2 ที่');
  await row.locator('[data-pl="note-save"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' }).locator('.pl-note')).toContainText('คัลกุกซุ');
  // แก้
  await pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' }).locator('[data-pl="note-edit"]').click();
  await pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' }).locator('textarea').fill('กินคัลกุกซุ');
  await pl.locator('.pl-row.stop', { hasText: 'Myeongdong Kyoja' }).locator('[data-pl="note-save"]').click();
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await expect(pl.locator('.pl-sum')).toContainText('กินคัลกุกซุ');
  // หน้าสรุป: ป้ายมื้อ + เวลาอยู่บรรทัดแยก
  const sumKyoja = pl.locator('.pl-sum .sum-stop', { hasText: 'Myeongdong Kyoja' });
  await expect(sumKyoja.locator('.pl-meal-tag')).toContainText('มื้อกลางวัน');
  await expect(sumKyoja.locator('.sum-meta')).toContainText('อยู่');
  await pl.locator('[data-pl="confirm"]').click();
  // หน้าแผนของฉัน: โน้ตแสดงใต้ชื่อ · หน้า วันนี้ ก็แสดง
  await gotoPlan(page);
  await expect(page.locator('.ov-day').first().locator('li', { hasText: 'Myeongdong Kyoja' })).toContainText('กินคัลกุกซุ');
  await gotoToday(page);
  await expect(page.locator('#right')).toContainText('กินคัลกุกซุ');
});

test('ร้านที่ยังไม่มีพิกัด: แตะแล้วบอกชัด · วางพิกัดจาก Google Maps → หมุดแดงขึ้น', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('29cm');
  await pl.locator('[data-pl="preview"][data-place="29cm-home-seongsu"]').click();
  await expect(pl.locator('.pl-nocoord')).toContainText('ยังไม่มีพิกัด');
  await expect(pl.locator('.pl-nocoord a')).toHaveAttribute('href', /google\.com\/maps/);
  await pl.locator('.pl-nocoord [name="coord"]').fill('hello');
  await pl.locator('.pl-nocoord button.primary').click();
  await expect(page.locator('#toast')).toContainText('อ่านพิกัดไม่ได้');
  await pl.locator('.pl-nocoord [name="coord"]').fill('37.5440, 127.0556');
  await pl.locator('.pl-nocoord button.primary').click();
  await expect(page.locator('#toast')).toContainText('บันทึกพิกัดแล้ว');
  await expect(pl.locator('.pl-pin.preview')).toContainText('29CM HOME Seongsu');
  await expect(pl.locator('.pl-nocoord')).toHaveCount(0);
});

test('หน้าเพิ่มสถานที่: แผนที่มีจุดอ้างอิง ที่พัก 2 แห่ง + สนามบิน (ไอคอนเส้น ไม่กดไม่ได้)', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="places"]').filter({ visible: true }).first().click();
  const lands = page.locator('#pp-map .pp-land');
  await expect(lands).toHaveCount(3);
  await expect(lands.filter({ hasText: 'ที่พัก เมียงดง' })).toHaveCount(1);
  await expect(lands.filter({ hasText: 'Novotel ซูวอน' })).toHaveCount(1);
  await expect(lands.filter({ hasText: 'สนามบิน ICN' })).toHaveCount(1);
  await expect(lands.first().locator('svg')).toHaveCount(1);
});

test('เพิ่มสถานที่เองในตัวจัดแผน: ชื่อ + หมวด + วางพิกัด → บันทึกแล้วใส่ลงช่อง · ค้นเจอภายหลัง', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('Nudake Seongsu');
  await pl.locator('[data-pl="own-open"]').click();
  const f = pl.locator('form[data-form="own-place"]');
  await expect(f.locator('[name="name"]')).toHaveValue('Nudake Seongsu');
  await expect(f.locator('a', { hasText: 'Google Maps' })).toHaveAttribute('href', /Nudake/);
  await f.locator('[name="category"]').selectOption('cafe');
  await f.locator('[name="coord"]').fill('37.5446, 127.0561');
  await f.locator('[name="stay"]').fill('40');
  await f.locator('button[value="add"]').click();
  await expect(page.locator('#toast')).toContainText('เพิ่ม Nudake Seongsu');
  await expect(pl.locator('.pl-row.stop', { hasText: 'Nudake Seongsu' })).toBeVisible();
  await expect(pl.locator('.pl-row.stop', { hasText: 'Nudake Seongsu' }).locator('[data-pl-change="stay-h"]')).toHaveValue('0');
  await expect(pl.locator('.pl-row.stop', { hasText: 'Nudake Seongsu' }).locator('[data-pl-change="stay-m"]')).toHaveValue('40');
  // ค้นเจอในรายการภายหลัง (หมวดคาเฟ่)
  await pl.locator('[data-pl="cat"][data-v="cafe"]').click();
  await expect(pl.locator('.pl-lane-list')).toContainText('Nudake Seongsu');
});

test('เพิ่มสถานที่เอง: ลิงก์ย่อ → บอกเหตุผลใต้ช่อง (ไม่หาย) · เลือกตำแหน่งด้วยการแตะบนแผนที่ได้', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('My Cafe');
  await pl.locator('[data-pl="own-open"]').click();
  const f = pl.locator('form[data-form="own-place"]');
  await f.locator('[name="coord"]').fill('https://maps.app.goo.gl/wjf34sTG61ZEu9N59');
  await f.locator('button[value="add"]').click();
  await expect(f.locator('.pl-own-error')).toContainText('ลิงก์ย่อ');
  await expect(f.locator('[name="name"]')).toHaveValue('My Cafe'); // ที่พิมพ์ไว้ไม่หาย
  // วาง Plus Code จาก Google Maps แทนได้
  await f.locator('[name="coord"]').fill('HX7M+HQ8 Seoul');
  await f.locator('button[value="save"]').click();
  await expect(page.locator('#toast')).toContainText('บันทึก My Cafe');
  await pl.locator('[data-pl="own-open"]').click();
  await pl.locator('form[data-form="own-place"] [name="name"]').fill('My Cafe 2');
  // แตะบนแผนที่เพื่อเลือกตำแหน่ง
  await f.locator('[data-pl="pick-map"]').click();
  await expect(pl.locator('.pl-pick-hint')).toBeVisible();
  const box = (await pl.locator('#pl-map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(f.locator('[name="coord"]')).toHaveValue(/^3\d\.\d+, 12\d\.\d+$/);
  await expect(pl.locator('.pl-pick-hint')).toHaveCount(0);
  await f.locator('button[value="add"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'My Cafe 2' })).toBeVisible();
});

test('ตัวจัดแผน: แก้แล้วรายการไม่เด้งกลับบนสุด · โน้ตที่กำลังพิมพ์ไม่หายเมื่อแก้เวลา · หน้าสรุปแผนที่ใหญ่', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await openTemplates(page);
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await page.evaluate(() => (document.querySelector('.pl-day')!.scrollTop = 400));
  const last = () => pl.locator('.pl-row.stop').last();
  await setStay(last(), 2, 0);
  expect(await page.evaluate(() => document.querySelector('.pl-day')!.scrollTop)).toBeGreaterThan(300);
  // โน้ตที่ยังไม่บันทึก + แก้เวลา → ข้อความยังอยู่
  await last().locator('[data-pl="note-edit"]').click();
  await last().locator('textarea').fill('เช็คอิน นอนพัก');
  await setStay(last(), 1, 30);
  await expect(last().locator('textarea')).toHaveValue('เช็คอิน นอนพัก');
  await last().locator('[data-pl="note-save"]').click();
  await expect(last().locator('.pl-note')).toContainText('เช็คอิน นอนพัก');
  // หมุดที่มีหลายลำดับ: ป้ายกว้างพอให้เห็นทุกตัวเลข
  const wide = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#pl-map .pl-pin span')].map((s) => s.scrollWidth - s.clientWidth)));
  expect(wide).toBeLessThanOrEqual(0);
  // หน้าสรุป: แผนที่กว้างอย่างน้อยครึ่งจอ
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  const w = await pl.locator('#pl-map').evaluate((e) => e.getBoundingClientRect().width / window.innerWidth);
  expect(w).toBeGreaterThanOrEqual(0.45);
});

test('ตัวจัดแผน: ร่างที่ยังไม่ยืนยันไม่หายเมื่อรีเฟรช → กู้คืนได้ / ทิ้งได้', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('กวางจัง');
  await pl.locator('[data-pl="add"][data-place="gwangjang"]').click();
  const row = pl.locator('.pl-row.stop', { hasText: 'Gwangjang Market' });
  await row.locator('[data-pl="note-edit"]').click();
  await row.locator('textarea').fill('กินบินแดต็อก');
  await row.locator('[data-pl="note-save"]').click();
  // รีเฟรชโดยไม่กดยืนยัน
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await openPlanner(page);
  await expect(pl.locator('.pl-restore')).toContainText('ร่างที่ยังไม่ยืนยัน');
  await pl.locator('[data-pl="draft-restore"]').click();
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await expect(pl.locator('.pl-sum')).toContainText('Gwangjang Market');
  await expect(pl.locator('.pl-sum')).toContainText('กินบินแดต็อก');
  // ยืนยันแล้ว ร่างถูกล้าง → เปิดใหม่ไม่ถามกู้
  await pl.locator('[data-pl="confirm"]').click();
  await openPlanner(page);
  await expect(pl.locator('.pl-restore')).toHaveCount(0);
});

test('แถบเมนูเห็นทุกหน้า รวมในตัวจัดแผน · กดเมนูแล้วออกจากตัวจัดแผนโดยร่างไม่หาย · ปุ่ม ← หน้าหลัก', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนใช้บนคอม/iPad');
  await page.goto('/');
  await page.locator('.main-menu [data-act="nav-planner"]').click();
  const pl = page.locator('#planner');
  await expect(pl).toBeVisible();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.main-menu [data-act="nav-planner"]')).toHaveCSS('color', /rgb/);
  // แก้เวลา → ร่างเก็บไว้
  await pl.locator('[data-pl-change="startTime"]').fill('07:45');
  await page.locator('.main-menu [data-tab="today"]').click();
  await expect(pl).toBeHidden();
  await expect(page.locator('.today-head')).toBeVisible();
  // เปิดใหม่ → มีร่างให้ใช้ต่อ
  await page.locator('.main-menu [data-act="nav-planner"]').click();
  await expect(pl.locator('.pl-restore')).toBeVisible();
  await pl.locator('[data-pl="cancel"]').click();
  await expect(pl).toBeHidden();
});

test('ชื่อวัน: ตั้งในตัวจัดแผน (มีชื่อแนะนำจากย่าน) → แสดงข้างวันที่ในหน้าแผนของฉันและหน้า วันนี้', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await applyTripTemplate(page);
  await openPlanner(page);
  const pl = page.locator('#planner');
  // แผนแนะนำวันแรกอยู่เมียงดง → มีปุ่มใช้ชื่อแนะนำ
  await expect(pl.locator('[data-pl="title-suggest"]')).toContainText('เมียงดง');
  await pl.locator('[data-pl-change="title"]').fill('เมียงดง · นัมแดมุน');
  await expect(pl.locator('.pl-daytitle')).toHaveText('เมียงดง · นัมแดมุน');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await pl.locator('[data-pl="confirm"]').click();
  await expect(page.locator('.ov-day').first().locator('.ov-title')).toHaveText('เมียงดง · นัมแดมุน');
  await gotoToday(page);
  await page.locator('[data-act-change="today-day"]').selectOption({ index: 0 });
  await expect(page.locator('.today-title')).toHaveText('เมียงดง · นัมแดมุน');
});

test('แท็บสถานที่: เพิ่มชื่อ + ตำแหน่ง (หมุดแดง) + โน้ต + ลิงก์ · เพิ่มรูป · เช็กหมุดใน Google Maps · ใช้ในแผนแล้วลบไม่ได้', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="places"]').filter({ visible: true }).first().click();
  const pp = page.locator('#places-page');
  await expect(pp.locator('#pp-map .leaflet-container, #pp-map.leaflet-container')).toBeVisible();
  await pp.locator('[data-pp="add"]').click();
  await pp.locator('[data-pp-field="name"]').fill('Onion Anguk');
  await pp.locator('[data-pp-cat="cafe"]').click();
  await expect(pp.locator('[data-pp-cat="cafe"]')).toHaveAttribute('aria-checked', 'true');
  await expect(pp.locator('[data-pp-field="stay"]')).toHaveCount(0);
  await pp.locator('[data-pp-field="coord"]').fill('HX7M+HQ8');
  await expect(pp.locator('.pp-coord-msg')).toContainText('ได้ตำแหน่งแล้ว');
  await expect(pp.locator('.pp-pin.preview span')).toBeVisible();
  await pp.locator('[data-pp-field="coord"]').fill('37.5776, 126.9869');
  await pp.locator('[data-pp-field="note"]').fill('คาเฟ่บ้านเก่า');
  await pp.locator('[data-pp-field="links"]').fill('https://www.instagram.com/onion.kr/\njavascript:alert(1)');
  await pp.locator('.pp-form button.primary').click();
  await expect(page.locator('#toast')).toContainText('ข้ามลิงก์ที่ไม่ใช่ http(s) 1');
  const card = pp.locator('.pp-card', { hasText: 'Onion Anguk' });
  await expect(card).toContainText('คาเฟ่บ้านเก่า');
  await expect(card.locator('.pinfo-links a')).toHaveCount(1);
  await expect(card.locator('.pinfo-links a')).toHaveAttribute('href', 'https://www.instagram.com/onion.kr/');
  await expect(card.locator('a', { hasText: 'ดูหมุดนี้ใน Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=37.5776,126.9869');
  await expect(pp.locator('.pp-pin span', { hasText: 'Onion Anguk' })).toBeVisible();
  // เพิ่มรูป → เห็นรูปย่อ · กดดูรูปใหญ่ · เก็บหลังรีโหลด
  await card.locator('[data-pp-photo]').setInputFiles('tests/e2e/fixture-photo.jpg');
  await expect(card.locator('.pinfo-ph img')).toHaveCount(1);
  await expect(card.locator('.pinfo-ph img')).toHaveAttribute('src', /^blob:/);
  await card.locator('.pinfo-ph').click();
  await expect(pp.locator('.pp-viewer img')).toHaveAttribute('src', /^blob:/);
  await pp.locator('[data-pp="viewer-close"]').click();
  await page.reload();
  await page.locator('[data-act="tab"][data-tab="places"]').filter({ visible: true }).first().click();
  await expect(pp.locator('.pp-card .pinfo-ph img')).toHaveAttribute('src', /^blob:/);
  // แก้ชื่อ
  await pp.locator('[data-pp="edit"]').click();
  await pp.locator('[data-pp-field="name"]').fill('Onion Anguk (คาเฟ่)');
  await pp.locator('.pp-form button.primary').click();
  await expect(pp.locator('.pp-card')).toContainText('Onion Anguk (คาเฟ่)');
  await expect(pp.locator('.pp-card .pinfo-ph img')).toHaveCount(1); // รูปเดิมยังอยู่
});

test('สถานที่ที่เพิ่มเองในตัวจัดแผน: แตะชื่อ = ดูรูป/ลิงก์ที่ใส่ไว้ · หน้าแผนของฉันแตะชื่อก็ดูได้ · อยู่ในแผนแล้วลบไม่ได้', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await page.locator('.main-menu [data-tab="places"]').click();
  const pp = page.locator('#places-page');
  await pp.locator('[data-pp="add"]').click();
  await pp.locator('[data-pp-field="name"]').fill('Onion Anguk');
  await pp.locator('[data-pp-field="coord"]').fill('37.5776, 126.9869');
  await pp.locator('[data-pp-field="links"]').fill('https://www.instagram.com/onion.kr/');
  await pp.locator('.pp-form button.primary').click();
  await pp.locator('[data-pp-photo]').setInputFiles('tests/e2e/fixture-photo.jpg');
  await expect(pp.locator('.pinfo-ph img')).toHaveAttribute('src', /^blob:/);
  // ใส่ลงวันแรกในตัวจัดแผน
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-input="q"]').fill('Onion');
  await pl.locator('.pl-item', { hasText: 'Onion Anguk' }).locator('[data-pl="add"]').click();
  await pl.locator('.pl-row.stop', { hasText: 'Onion Anguk' }).locator('[data-pl="place-info"]').click();
  await expect(pl.locator('.pl-info-pop img')).toHaveAttribute('src', /^blob:/);
  await expect(pl.locator('.pl-info-pop')).toContainText('Instagram');
  await pl.locator('[data-pl="info-close"]').click();
  await pl.locator('.pl-steps [data-pl="goto"][data-v="4"]').click();
  await pl.locator('[data-pl="confirm"]').click();
  // หน้าแผนของฉัน: แตะชื่อ → หน้าต่างสถานที่มีรูป
  await page.locator('.ov-day').first().locator('[data-act="place-modal"]', { hasText: 'Onion Anguk' }).click();
  await expect(page.locator('.modal.sheet .psheet-ph img[data-pphoto]')).toHaveAttribute('src', /^blob:/);
  await page.locator('.modal [data-act="modal-close"]').first().click();
  // ลบไม่ได้เพราะอยู่ในแผน
  await page.locator('.main-menu [data-tab="places"]').click();
  await pp.locator('[data-pp="delete"]').click();
  await expect(page.locator('#toast')).toContainText('ลบไม่ได้');
  await expect(pp.locator('.pp-card')).toHaveCount(1);
});

test('แถบเมนูบน: ตัวอักษรล้วน ไม่มีปุ่มแม่แบบ · แม่แบบอยู่ในตั้งค่า', async ({ page }) => {
  test.skip(isMobile(page), 'แถบบนแบบเต็มเฉพาะคอม');
  await page.goto('/');
  await expect(page.locator('.topbar [data-act="open-templates"]')).toHaveCount(0);
  const labels = await page.locator('.main-menu button').allInnerTexts();
  expect(labels).toEqual(['วันนี้', 'แผนของฉัน', 'จัดแผน', 'เพิ่มสถานที่', 'สิ่งของที่ต้องใช้', 'แปลงเงิน']);
  await openTemplates(page);
  await expect(page.locator('.modal')).toContainText('เลือกแผนรายวัน');
});

test('สิ่งของที่ต้องใช้: รายการแนะนำ · แตะทั้งแถวเพื่อติ๊ก · เพิ่มในหมวด · ลบ/เลิกทำ · ซ่อนที่เตรียมแล้ว · เก็บหลังรีโหลด', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="tab"][data-tab="packing"]').filter({ visible: true }).first().click();
  const pk = page.locator('#packing-page');
  await expect(pk.locator('.pk-group h3').first()).toContainText('เอกสารและเงิน');
  const total = await pk.locator('.pk-item').count();
  expect(total).toBeGreaterThan(20);
  await expect(pk.locator('.pk-count')).toContainText(`0 / ${total}`);
  // แตะชื่อของ = ติ๊ก
  const passport = pk.locator('.pk-item', { hasText: 'พาสปอร์ต' });
  await passport.locator('.pk-text').click();
  await expect(passport).toHaveClass(/done/);
  await expect(pk.locator('.pk-count')).toContainText(`1 / ${total}`);
  // เพิ่มของในหมวด → ช่องยังโฟกัสอยู่ พิมพ์ต่อได้
  const docs = pk.locator('form[data-pk-group="เอกสารและเงิน"] input');
  await docs.fill('สำเนาพาสปอร์ต');
  await docs.press('Enter');
  await expect(pk.locator('.pk-group').first()).toContainText('สำเนาพาสปอร์ต');
  await expect(pk.locator('form[data-pk-group="เอกสารและเงิน"] input')).toBeFocused();
  // ลบ → เลิกทำ
  await pk.locator('.pk-item', { hasText: 'สำเนาพาสปอร์ต' }).locator('.pk-del').click();
  await expect(pk.locator('.pk-item', { hasText: 'สำเนาพาสปอร์ต' })).toHaveCount(0);
  await page.locator('[data-act="toast-undo"]').click();
  await expect(pk.locator('.pk-item', { hasText: 'สำเนาพาสปอร์ต' })).toHaveCount(1);
  // ซ่อนที่เตรียมแล้ว
  await pk.locator('[data-pk="hide-done"]').click();
  await expect(pk.locator('.pk-item', { hasText: 'พาสปอร์ต (อายุ' })).toHaveCount(0);
  await pk.locator('[data-pk="hide-done"]').click();
  // เพิ่มหมวดใหม่
  await pk.locator('[data-pk="add-group"]').click();
  await pk.locator('.pk-newgroup [name="group"]').fill('ของฝาก');
  await pk.locator('.pk-newgroup [name="text"]').fill('ขนมให้ทีม');
  await pk.locator('.pk-newgroup button.primary').click();
  await expect(pk.locator('.pk-group', { hasText: 'ของฝาก' })).toContainText('ขนมให้ทีม');
  // เก็บหลังรีโหลด
  await page.reload();
  await page.locator('[data-act="tab"][data-tab="packing"]').filter({ visible: true }).first().click();
  await expect(pk.locator('.pk-item', { hasText: 'พาสปอร์ต (อายุ' })).toHaveClass(/done/);
  await expect(pk.locator('.pk-group', { hasText: 'ของฝาก' })).toBeVisible();
  // ล้างเครื่องหมาย (เช็กขากลับ)
  await pk.locator('[data-pk="reset"]').click();
  await expect(pk.locator('.pk-item.done')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('เพิ่มสถานที่: เลือกย่านเอง → กรองย่านในตัวจัดแผนเจอ · ไม่เลือก = เดาจากตำแหน่ง', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await page.locator('.main-menu [data-tab="places"]').click();
  const pp = page.locator('#places-page');
  // ไม่เลือกย่าน: วางพิกัดกลางเมียงดง → เดาได้
  await pp.locator('[data-pp="add"]').click();
  await pp.locator('[data-pp-field="name"]').fill('ร้านในเมียงดง');
  await pp.locator('[data-pp-field="coord"]').fill('37.563913, 126.984453');
  await expect(pp.locator('[data-pp-field="zone"] option').first()).toContainText('เดาจากตำแหน่ง: เมียงดง');
  await pp.locator('.pp-form button.primary').click();
  await expect(pp.locator('.pp-card', { hasText: 'ร้านในเมียงดง' })).toContainText('เมียงดง');
  // เลือกย่านเอง: ตลาดคริสต์มาสที่จัมซิล
  await pp.locator('[data-pp="add"]').click();
  await pp.locator('[data-pp-field="name"]').fill('Lotte Town Christmas Market');
  await pp.locator('[data-pp-cat="sight"]').click();
  await pp.locator('[data-pp-field="coord"]').fill('37.5121875, 127.0993125');
  await pp.locator('[data-pp-field="zone"]').selectOption('jamsil');
  await pp.locator('.pp-form button.primary').click();
  await expect(pp.locator('.pp-card', { hasText: 'Lotte Town' })).toContainText('จัมซิล');
  // ตัวจัดแผน: กรองย่าน จัมซิล → เจอ
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await pl.locator('[data-pl-change="zone"]').selectOption('jamsil');
  await expect(pl.locator('.pl-item', { hasText: 'Lotte Town Christmas Market' })).toHaveCount(1);
  await pl.locator('[data-pl-change="zone"]').selectOption('myeongdong');
  await expect(pl.locator('.pl-item', { hasText: 'ร้านในเมียงดง' })).toHaveCount(1);
});

test('เวลาอยู่: พิมพ์ชั่วโมง/นาทีเองได้ สูงสุด 20 ชม. · สถานที่ที่ยังไม่มีพิกัดใส่ได้ในหน้าเพิ่มสถานที่', async ({ page }) => {
  test.skip(isMobile(page), 'ตัวจัดแผนบนคอม/iPad');
  await page.goto('/');
  await applyTripTemplate(page);
  await openPlanner(page);
  const pl = page.locator('#planner');
  await pl.locator('.pl-steps [data-pl="goto"][data-v="2"]').click();
  const row = pl.locator('.pl-row.stop').first();
  await setStay(row, 5, 15);
  await expect(pl.locator('.pl-row.stop').first()).toContainText('ถึง');
  await expect(pl.locator('.pl-row.stop').first().locator('[data-pl-change="stay-h"]')).toHaveValue('5');
  await expect(pl.locator('.pl-row.stop').first().locator('[data-pl-change="stay-m"]')).toHaveValue('15');
  await setStay(pl.locator('.pl-row.stop').first(), 25, 0);
  await expect(pl.locator('.pl-row.stop').first().locator('[data-pl-change="stay-h"]')).toHaveValue('20');
  await expect(page.locator('#toast')).toContainText('สูงสุด 20 ชั่วโมง');
  await pl.locator('[data-pl="cancel"]').click();
  // หน้าเพิ่มสถานที่: รายการที่ยังไม่มีพิกัด → วางพิกัดแล้วหายจากรายการ
  await page.locator('.main-menu [data-tab="places"]').click();
  const miss = page.locator('.pp-missing');
  await expect(miss).toContainText('ยังไม่มีพิกัด 4 แห่ง');
  const item = miss.locator('.pp-missing-item', { hasText: '29CM HOME Seongsu' });
  await item.locator('input[name="coord"]').fill('37.5446, 127.0557');
  await item.locator('button.primary').click();
  await expect(page.locator('#toast')).toContainText('บันทึกพิกัดแล้ว');
  await expect(miss).toContainText('ยังไม่มีพิกัด 3 แห่ง');
  await expect(miss.locator('.pp-missing-item', { hasText: '29CM HOME Seongsu' })).toHaveCount(0);
});
