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
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="plan"]').click();
}
async function gotoPlaces(page: Page) {
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="places"]').click();
}
async function setDay(page: Page, date: string, time: string, endTime = '22:00') {
  await gotoPlan(page);
  // วันที่ตั้งค่าครบแล้ว (เช่นวันแรกที่ตั้งเวลาออกจากสนามบินไว้) จะพับกล่องตั้งค่า → เปิดก่อน
  if (!(await page.locator('[data-field="date"]').isVisible())) await page.locator('.day-summary[data-act="toggle-settings"]').click();
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
  // ไม่มีคีย์ → ใช้แผนที่ OpenStreetMap ฟรีแทน
  if (isMobile(page)) await page.locator('.bottom-nav [data-tab="map"]').click();
  await expect(page.locator('#map .leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await setDay(page, '2026-11-20', '18:00');
  // แตะสถานที่ = เพิ่มเข้าวันทันที (ไม่ต้องยืนยัน) + เลิกทำได้
  await gotoPlaces(page);
  await page.locator('[data-filter="q"]').fill('Starfield Library');
  await page.locator('[data-place-card="library"] .place-main').click();
  await expect(page.locator('#toast')).toContainText('เพิ่ม');
  await expect(page.locator('[data-place-card="library"] .add-btn')).toHaveText('✓');
  await page.locator('[data-act="toast-undo"]').click();
  await expect(page.locator('[data-place-card="library"] .add-btn')).toHaveText('＋');
  await page.locator('[data-place-card="library"] .add-btn').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('ห้องสมุดสตาร์ฟิลด์');
  // ข้อมูลขาด (มื้อที่ยังไม่เลือกร้าน): ไม่สรุปว่า "ทัน" — บอกว่ายังสรุปไม่ได้ หรือเกินแน่นอนแล้ว
  await expect(page.locator('.banner')).toContainText(/ยังสรุปไม่ได้ว่าทัน|เกินเวลา/);
  await expect(page.locator('.banner')).not.toContainText('ทันเวลา');
  // กรอกเวลาเดินทางเองทุกช่วงที่มีการเคลื่อนที่ (โรงแรม→ห้องสมุด, ห้องสมุด→มื้อเย็น(ยังไม่เลือก), →โรงแรม)
  await expect(page.locator('.leg .leg-time').first()).toContainText('≈'); // ยังไม่มีข้อมูล → เวลาประมาณจากระยะ
  await page.locator('[data-act="leg-info"]').first().click();
  const manual = page.locator('.modal [data-act-change="leg-manual"]');
  await manual.fill('40');
  await manual.dispatchEvent('change');
  await expect(page.locator('.modal .leg-now')).toContainText('กำหนดเอง');
  await page.locator('.modal [data-act="modal-close"]').last().click();
  await expect(page.locator('.stop').first()).toContainText('18:45'); // 40 นาที + เวลาเผื่อ 5 นาที (แยกบรรทัด)
  await expect(page.locator('.leg').first()).toContainText('+ เผื่อ 5 นาที');
  // เปลี่ยนเวลาเริ่ม → ตารางเลื่อนตาม
  await page.locator('[data-field="startTime"]').fill('19:00');
  await page.locator('[data-field="startTime"]').dispatchEvent('change');
  await expect(page.locator('.stop').first()).toContainText('19:45');
});

test('อากาศจับคู่วันที่เกาหลี เน้นช่วงเย็น และวันนอกช่วงไม่แสดงข้อมูลปลอม', async ({ page }) => {
  await page.goto('/');
  await gotoPlan(page);
  // แผนใหม่มีวันที่ทริป (30 พ.ย.) ซึ่งเกินช่วงพยากรณ์ของข้อมูลจำลอง → ไม่แสดงตัวเลข
  await expect(page.locator('.wx')).toContainText('ยังไม่มีพยากรณ์สำหรับวันนี้');
  // ลบวันที่ → ขอให้เลือกวันที่ (วันแรกตั้งค่าครบแล้วจึงพับไว้ → เปิดกล่องตั้งค่าก่อน)
  if (!(await page.locator('[data-field="date"]').isVisible())) await page.locator('.day-summary[data-act="toggle-settings"]').click();
  await page.locator('[data-field="date"]').fill('');
  await page.locator('[data-field="date"]').dispatchEvent('change');
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
  await expect(page.locator('.day-summary')).toContainText('09:30');
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
  await expect(p2.locator('.day-summary')).toContainText('09:30');
  await expect(p2.locator('.day-summary')).toContainText('21 พ.ย. 2026');
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
    const moveBtn = await page.locator('[data-act="stop-info"]').first().boundingBox();
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
  await page.locator('[data-act="tpl-tab"][data-v="A"]').click();
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
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click(); // แผนแนะนำแบบลงวันที่
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('มยองดงเกียวจา');
  const first = page.locator('.stop .stop-title .t').first();
  const firstText = await first.textContent();
  await page.locator('[data-act="stop-info"]').first().click();
  await page.locator('.modal [data-act="stop-down"]').click();
  await expect(page.locator('.stop .stop-title .t').nth(1)).toHaveText(firstText!);
  const count = await page.locator('.stop').count();
  // หน้าต่างยังเปิดค้างอยู่ → กดลบได้เลย
  await page.locator('.modal [data-act="stop-remove"]').click();
  await expect(page.locator('.stop')).toHaveCount(count - 1);
});

test('ย้ายจุดแวะไปวันอื่น และเลิกทำได้', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('มยองดงเกียวจา');
  const card = page.locator('.stop', { hasText: 'มยองดงเกียวจา' });
  await card.locator('[data-act="stop-info"]').click();
  const target = await page.locator('.modal [data-act-change="stop-move-day"] option').nth(2).getAttribute('value'); // วัน 3
  await page.locator('.modal [data-act-change="stop-move-day"]').selectOption(target!);
  await expect(page.locator('#toast')).toContainText('ไปวัน 3');
  await expect(page.locator('.timeline')).not.toContainText('มยองดงเกียวจา');
  await page.locator('[data-act="toast-undo"]').click();
  await expect(page.locator('.timeline')).toContainText('มยองดงเกียวจา');
});

test('เลือกแผนรายวัน: ใช้การ์ดกับวันที่เลือก นัดที่ล็อกยังอยู่ และเติมที่ใกล้เคียงเองได้', async ({ page }) => {
  await page.goto('/');
  // วัน 4 (3 ธ.ค.) มีนัด COEX ที่ล็อกไว้จากแผนแนะนำ
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await page.locator('[data-act="open-templates"]').click();
  await expect(page.locator('.modal')).toContainText('เลือกแผนรายวัน');
  const card = page.locator('.tpl-day', { hasText: 'ฮงแด ช็อปตอนเย็น' });
  const day4 = await card.locator('[data-act-change="tpl-target"] option').nth(3).getAttribute('value');
  await card.locator('[data-act-change="tpl-target"]').selectOption(day4!);
  await page.locator('.tpl-day', { hasText: 'ฮงแด ช็อปตอนเย็น' }).locator('[data-act="tpl-copy-day"][data-mode="replace"]').click();
  await expect(page.locator('#toast')).toContainText('เป็นวัน 4');
  await gotoPlan(page);
  await expect(page.locator('.timeline')).toContainText('โคเอ็กซ์'); // นัดที่ล็อกยังอยู่
  await expect(page.locator('.timeline')).toContainText('จังอิน');
  // เติมที่ใกล้เคียงเองจากการ์ด
  await page.locator('[data-act="open-templates"]').click();
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

test('Naver Map: ปุ่มเส้นทางรถเมล์/รถไฟ และคำแนะนำเมื่อเปิดแอปไม่ได้', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await page.locator('.timeline [data-act="leg-info"]').nth(1).click();
  const btn = page.locator('.modal [data-act="naver"]').first();
  await expect(btn).toBeVisible();
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
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await page.locator('[data-act="tab"][data-tab="today"]').filter({ visible: true }).first().click();
  const hero = page.locator('.hero');
  await expect(page.locator('.today-head')).toContainText('ตอนนี้ 10:00');
  await expect(hero).toContainText('เริ่มวัน');
  await expect(hero).toContainText('ช้ากว่าแผน'); // แผนออก 08:30
  await page.locator('[data-act="live-start"]').click();
  await expect(page.locator('#toast')).toContainText('ออกเดินทาง 10:00');
  await expect(hero).toContainText('กำลังไป');
  await expect(hero).toContainText('ตลาดกวางจัง');
  await expect(hero).toContainText('เดินทาง'); // มีเวลาเดินทาง (≈ ประมาณ)
  await expect(hero.locator('[data-act="naver"]')).toBeVisible();
  await page.locator('[data-act="live-arrive"]').click();
  await expect(hero).toContainText('ตอนนี้อยู่ที่');
  await expect(hero).toContainText('อยู่ได้อีก');
  await expect(hero.locator('.hero-next')).toContainText('โซฮา'); // ถัดไป
  // timeline: ออกจากโรงแรม ✓ และจุดปัจจุบัน
  await expect(page.locator('.tl.done').first()).toContainText('ออกจาก');
  await expect(page.locator('.tl.now')).toContainText('ตลาดกวางจัง');
  // เลิกทำการเช็กอินล่าสุด
  await page.locator('[data-act="toast-undo"]').click();
  await expect(hero).toContainText('กำลังไป');
  await page.locator('[data-act="live-arrive"]').click();
  await page.locator('[data-act="live-depart"]').click();
  await expect(hero).toContainText('กำลังไป');
  await expect(hero).toContainText('โซฮา');
  // วันอื่น = ดูล่วงหน้า ไม่มีปุ่มเช็กอิน
  await page.locator('[data-act-change="today-day"]').selectOption({ index: 2 });
  await expect(page.locator('.today-head')).toContainText('ดูล่วงหน้า');
  await expect(page.locator('[data-act^="live-"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('มื้ออาหาร: เลือกเช้า/กลางวัน/เย็น/ระหว่างทาง และเปลี่ยนได้ใน ⓘ · แถวแผนแบบย่อ', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-act="tpl-tab"][data-v="T"]').click();
  await page.locator('[data-act="tpl-apply-all"]').click();
  await page.locator('[data-act="confirm-ok"]').click();
  await gotoPlan(page);
  await page.locator('[data-act="add-item"][data-kind="dinner"]').click();
  await expect(page.locator('.modal')).toContainText('มื้อกลางวัน');
  await page.locator('.modal [data-act="meal-add"][data-v="lunch"]').click();
  await expect(page.locator('#toast')).toContainText('เพิ่มมื้อกลางวัน');
  const lunch = page.locator('.stop', { hasText: 'มื้อกลางวัน' });
  await expect(lunch).toBeVisible();
  // ⓘ → เปลี่ยนเป็นมื้อระหว่างทาง
  await lunch.locator('[data-act="stop-info"]').click();
  await page.locator('.modal [data-act="meal-set"][data-v="snack"]').click();
  await expect(page.locator('.timeline')).toContainText('มื้อระหว่างทาง');
  await page.locator('.modal [data-act="modal-close"]').last().click();
  // แถวเดินทางแบบย่อ: ไม่มีช่องกรอก/ลิงก์ลอย ๆ — มีเวลา + วิธีไป + ⓘ
  await expect(page.locator('.timeline [data-act-change="leg-manual"]')).toHaveCount(0);
  await expect(page.locator('.timeline .leg.slim [data-act="leg-info"]').first()).toBeVisible();
  await expect(page.locator('.timeline')).not.toContainText('≈ 0 ม.');
});

test('จัดแผนแบบขั้นตอน (คอม/iPad): ตั้งวัน → เลือกสถานที่ → เดินทาง → สรุป → ยืนยัน · ปุ่มคืนค่า ↺', async ({ page }) => {
  test.skip(isMobile(page), 'ออกแบบให้จัดแผนบนคอม/iPad');
  await page.goto('/');
  await page.locator('[data-act="open-planner"]').click();
  const pl = page.locator('#planner');
  await expect(pl).toBeVisible();
  // ขั้น 1: เปลี่ยนเวลา แล้วกด ↺ กลับค่าที่ระบบตั้งไว้ (วันแรก = ออกจากสนามบิน 08:00)
  await pl.locator('[data-pl-change="startTime"]').fill('10:30');
  await pl.locator('[data-pl-change="startTime"]').dispatchEvent('change');
  await pl.locator('[data-pl="reset-field"][data-v="startTime"]').click();
  await expect(pl.locator('[data-pl-change="startTime"]')).toHaveValue('08:00');
  await expect(pl.locator('.pl-hours')).toContainText('วันนี้มีเวลา');
  // ปุ่มด้านล่างขนาดปกติ
  const box = await pl.locator('.pl-foot .pl-btn.primary').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(48);
  // ขั้น 2: ค้นหาทั้งหมดมีสถานที่หลัก · ใส่โรงแรมและร้าน · เปลี่ยนเวลาอยู่แล้ว ↺
  await pl.locator('.pl-foot [data-pl="goto"][data-v="2"]').click();
  await pl.locator('[data-pl="clear-stops"]').click();
  await pl.locator('[data-pl="lane"][data-v="search"]').click();
  await expect(pl.locator('.pl-group').first()).toContainText('สถานที่หลัก');
  await pl.locator('[data-pl="add"][data-place="hotel"]').click();
  await pl.locator('[data-pl-input="q"]').fill('กวางจัง');
  // แตะชื่อ = ดูหมุดแดงก่อน (ยังไม่ใส่) พร้อมระยะจากจุดก่อนหน้า
  await pl.locator('[data-pl="preview"][data-place="gwangjang"]').click();
  await expect(pl.locator('.pl-pin.preview')).toContainText('ตลาดกวางจัง');
  await expect(pl.locator('.pl-item.preview .pl-preview-info')).toContainText('ห่างจาก');
  await expect(pl.locator('.pl-row.stop', { hasText: 'ตลาดกวางจัง' })).toHaveCount(0);
  await pl.locator('[data-pl="add"][data-place="gwangjang"]').click();
  await expect(pl.locator('.pl-pin.preview')).toHaveCount(0);
  // ใส่สถานที่เดิมซ้ำได้ (เช่นแวะกลับโรงแรม) · หมุดเดียวบอกหลายลำดับ
  await pl.locator('[data-pl-input="q"]').fill('');
  await pl.locator('[data-pl-input="q"]').dispatchEvent('input');
  await expect(pl.locator('.pl-item', { hasText: 'โรงแรม Sotetsu' }).first()).toContainText('อยู่ในแผนแล้ว');
  await pl.locator('[data-pl="add"][data-place="hotel"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'โรงแรม Sotetsu' })).toHaveCount(2);
  await expect(pl.locator('.pl-pin span', { hasText: ',' }).first()).toBeVisible();
  await pl.locator('.pl-row.stop', { hasText: 'โรงแรม Sotetsu' }).last().locator('[data-pl="remove"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'โรงแรม Sotetsu' })).toHaveCount(1);
  const row = pl.locator('.pl-row.stop', { hasText: 'ตลาดกวางจัง' });
  await expect(row).toBeVisible();
  await row.locator('[data-pl-change="stay"]').selectOption('120');
  await row.locator('[data-pl="reset-stay"]').click();
  await expect(pl.locator('.pl-row.stop', { hasText: 'ตลาดกวางจัง' }).locator('[data-pl="reset-stay"]')).toHaveCount(0);
  await expect(pl.locator('.pl-budget')).toContainText('จาก');
  // ขั้น 3: แก้เวลาเดินทาง แล้ว ↺
  await pl.locator('.pl-foot [data-pl="goto"][data-v="3"]').click();
  const t = pl.locator('[data-pl-change="travel"]').first();
  await t.fill('70');
  await t.dispatchEvent('change');
  await expect(pl.locator('[data-pl="reset-leg"]').first()).toBeVisible();
  await pl.locator('[data-pl="reset-step"][data-v="3"]').click();
  await expect(pl.locator('[data-pl="reset-leg"]')).toHaveCount(0);
  // ขั้น 4: สรุป · แก้ → กลับขั้น 2 → กลับหน้าสรุป · ยืนยัน → ไปหน้า วันนี้
  await pl.locator('.pl-foot [data-pl="goto"][data-v="4"]').click();
  await expect(pl.locator('.pl-sum')).toContainText('ตลาดกวางจัง');
  await pl.locator('[data-pl="edit"][data-v="2"]').first().click();
  await expect(pl.locator('.pl-steps li.on')).toContainText('เลือกสถานที่');
  await pl.locator('.pl-foot [data-pl="goto"][data-v="4"]').click();
  await pl.locator('[data-pl="confirm"]').click();
  await expect(pl).toBeHidden();
  await expect(page.locator('#toast')).toContainText('บันทึกแผนวันนี้แล้ว');
  await expect(page.locator('body')).toHaveAttribute('data-tab', 'today');
  await expect(page.locator('.tl-list')).toContainText('ตลาดกวางจัง');
});
