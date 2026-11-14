# Shopping List (ของที่จะซื้อ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device-local shopping list inside the "₩ แปลงเงิน" tab. Each item compares its Thai price with the cheapest Korean price, and compares prices between Korean shops.

**Architecture:** Pure data and maths live in `src/services/shop.ts`: types, load/save to localStorage with validation, cheapest price, verdict, and totals. These are unit-tested. The view lives in `src/ui/views/shop.ts` and renders HTML strings in the same style as `src/ui/views/fx.ts`. `src/main.ts` holds the handlers (`data-act` clicks, `data-form` submits) and the `[แปลงเงิน|ของที่จะซื้อ]` switch. The rate comes from `activeRate(loadFx())`.

**Tech Stack:** Vite + TypeScript, Vitest, Playwright (all existing).

**Spec:** `docs/superpowers/specs/2026-11-14-shopping-list-design.md`

## Global Constraints
- Storage key `stp.v1.shop`. Device-only: never written into Plan, share links, JSON export or sync.
- Caps: 200 items, 20 prices per item. Name ≤ 80 chars, store ≤ 60 chars, label ≤ 30 chars.
- With no rate, show KRW only and never show a guessed THB value.
- Every delete (item, price, clear bought) has undo through `app.showToast(msg, undo)`.
- Mobile-first, so no horizontal overflow at 390 px. Amount inputs use `inputmode="decimal"` and reuse `formatTyping` and `parseAmount`.

## Review Focus
- Thai price set, no Korean price (or the reverse): no verdict, prices only, and no NaN anywhere.
- Rate missing: summary and verdict hide THB, and KRW totals still show.
- Corrupt or old localStorage: load drops bad entries and never throws.
- Qty 0, empty or huge: clamp to 1..99.
- Bought items still count in the "ซื้อแล้ว x/y" counter but drop out of the "ยังต้องซื้อ" total.

---

### Task 1: Shop model and maths

**Files:**
- Create: `src/services/shop.ts`
- Test: `tests/unit/shop.test.ts`

**Interfaces (Produces):**
```ts
export interface ShopPrice { id: string; store: string; krw: number }
export interface ShopItem { id: string; name: string; qty: number; thb: number | null; thbLabel: string; prices: ShopPrice[]; bought: boolean }
export interface ShopStore { items: ShopItem[]; lastStore: string }
export function loadShop(): ShopStore            // validated, caps applied, never throws
export function saveShop(s: ShopStore): void
export function sanitizeShop(raw: unknown): ShopStore
export function cheapest(item: ShopItem): ShopPrice | null   // ties → first added
export interface Verdict { kind: 'korea' | 'thai' | 'same'; diffThbPerUnit: number; pct: number; totalThb: number }
export function verdict(item: ShopItem, rate: number | null): Verdict | null  // null if thb, cheapest or rate missing
export function summary(items: ShopItem[], rate: number | null): { toBuyKrw: number; toBuyThb: number | null; savedThb: number | null; bought: number; total: number }
export function sortItems(items: ShopItem[]): ShopItem[]     // not bought first, keeps insertion order
```

- [ ] Step 1: Write the tests (rate 40):
  - Prices ₩18,000 and ₩21,000 → `cheapest` returns the ₩18,000 one.
  - Item thb 580, cheapest ₩18,000, qty 2 → `verdict` = `{kind:'korea', diffThbPerUnit:130, pct≈22.4, totalThb:260}`.
  - Thai cheaper → `kind:'thai'`.
  - Missing thb, no prices, or rate null → `null`.
  - `summary`: bought items are excluded from `toBuyKrw`; `toBuyThb` is null when rate is null; `savedThb` only sums items with a `'korea'` verdict.
  - `sanitizeShop`:
    - `({items:[{name:'',...}, 'x', {name:'A', qty:0, prices:[{store:'S', krw:-5}, {store:'T', krw:1000}]}]})` keeps 1 item with qty 1 and only the T price.
    - 250 items are capped to 200.
    - `sanitizeShop('garbage')` returns `{items:[], lastStore:''}`.
  - `sortItems`: bought items move to the end, in stable order.
- [ ] Step 2: `npx vitest run tests/unit/shop.test.ts` → FAIL (module missing).
- [ ] Step 3: Implement. Use `safeGet`/`safeSet` from `src/storage/storage.ts`. Ids come from `uid()` in `src/core/planOps.ts`. Money is converted with `thb = krw / rate`.
- [ ] Step 4: Re-run → PASS. `npx tsc --noEmit` is clean.
- [ ] Step 5: Commit `feat(shop): shopping list model, validation and comparison maths`.

### Task 2: Shopping list screen in the money tab

**Files:**
- Create: `src/ui/views/shop.ts` (`renderShop(store: ShopStore, rate: number | null, ui: ShopUi): string`, with `ShopUi = { adding: boolean; editItem: string | null; priceFor: string | null; editPrice: string | null }`)
- Modify: `src/main.ts` (fx tab switch plus handlers), `src/ui/views/fx.ts` (segmented switch markup), `src/style.css`
- Test: `tests/e2e/app.spec.ts` (new test)

**Interfaces (Consumes):** everything listed in Task 1, plus `activeRate`, `formatTyping` and `parseAmount`. The store suggestions `<datalist id="shop-stores">` come from `app.places()` (categories fashion, beauty and market, plus custom places), with the store names already used in the list added on top.

UI contract:
- **Switch:** `[data-act="money-view"][data-v="fx"|"shop"]`.
- **Items:**
  - `[data-act="shop-add"]` opens the inline form `form[data-form="shop-item"]` with fields name, thb, thbLabel and qty.
  - Each card is `[data-shop-item=<id>]`.
  - Card buttons: `[data-act="shop-bought"]`, `[data-act="shop-edit"]` (reuses the same form, prefilled) and `[data-act="shop-del"]` (deletes with undo).
- **Prices:**
  - `[data-act="shop-price-add"]` opens `form[data-form="shop-price"]` with fields store (prefilled with `lastStore`) and krw.
  - Tapping a price row (`[data-act="shop-price-edit"]`) opens the same form prefilled, with a 🗑 button `[data-act="shop-price-del"]`.
- **Clear bought:** `[data-act="shop-clear-bought"]` uses `confirmThen`, then undo.
- **Copy:**
  - Cheapest price row: 🏆.
  - Verdict 'korea': `ซื้อที่เกาหลีถูกกว่าไทย ฿{diff}/ชิ้น ({pct}%)`, plus `· {qty} ชิ้นประหยัด ฿{total}` when qty > 1.
  - Verdict 'thai': `ไทยถูกกว่า ฿{diff}/ชิ้น`.
  - Summary line: `ยังต้องซื้อ ₩{toBuyKrw} ≈ ฿{toBuyThb} · ประหยัดกว่าไทย ฿{savedThb} · ซื้อแล้ว {bought}/{total}`.
- **Re-render rules:** render only when the store or ui changes (same signature approach as `renderFxPage`). An open form keeps focus, and the item name input gets autofocus.

- [ ] Step 1: Write the e2e test `ของที่จะซื้อ: เพิ่ม/เทียบราคา/แก้/ลบ/เลิกทำ`, with rate mocked at 40:
  1. Add "กันแดด" with ฿580 and qty 2.
  2. Add prices Olive Young ₩18,000 and Daiso ₩21,000. Expect 🏆 on the Olive Young row and the text `ถูกกว่าไทย ฿130/ชิ้น`.
  3. Edit the Daiso price to ₩15,000 → 🏆 moves to Daiso.
  4. Delete the item → it is gone. Press undo → it is back.
  5. Reload the page → the item is still there.
  6. No horizontal overflow.
- [ ] Step 2: `npm run build && npx playwright test -g "ของที่จะซื้อ"` → FAIL.
- [ ] Step 3: Implement the view, handlers and CSS (reuse the `.fx-*` look: cards, chips, big tap targets).
- [ ] Step 4: `npm test && npm run build && npx playwright test` → all PASS. Also check a 390 px screenshot by eye.
- [ ] Step 5: Commit `feat(shop): ของที่จะซื้อ screen — compare Thai vs Korea and between shops`.
