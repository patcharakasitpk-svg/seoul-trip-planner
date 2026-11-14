# Shopping list with price comparison (ของที่จะซื้อ)

## Intent
While planning (in Thailand) and while walking shops in Seoul, the traveller wants a list of things to buy, and for each item to see:
1. **Thailand vs Korea**: Thai price (THB) vs the cheapest Korean price (KRW converted to THB), so they know whether it is worth buying in Korea.
2. **Korean store vs Korean store**: KRW prices at several shops, with the cheapest one highlighted.

Mobile-first, as simple as possible, usable one-handed in a shop.

## Decisions (user)
- Use cases: both pre-trip research and on-the-spot entry in shops.
- Comparison: Thai price vs Korea, and between Korean shops.
- Storage: **this device only**, separate from the trip plan (not synced, not shared, not in plan JSON/links).

## Approaches considered
1. Store the list inside the trip plan. It would sync with friends and travel with exports, but it mixes with plans. **Not chosen** by user.
2. **Separate device-local list (chosen).** Private and simple. A friend cannot see it.

## Design
- **Where:** inside the existing "₩ แปลงเงิน" tab, with a two-way switch at the top: `[แปลงเงิน] [ของที่จะซื้อ]`. The bottom nav stays at 5 buttons. *(my call: keeps the nav uncluttered; both screens are about money)*
- **Rate:** the same active rate as the converter, including the user's custom rate. With no rate yet, KRW is shown alone and nothing is guessed.
- **Item card:** name, qty (default 1), "bought" checkbox, Thai price (THB, optional, with a short source label such as "Shopee"), and Korean prices (store + KRW, many). The cheapest Korean price gets 🏆. Verdict line:
  - Korea cheaper: "ซื้อที่เกาหลีถูกกว่าไทย ฿X/ชิ้น (Y%)" with total saving × qty
  - Thai cheaper: "ไทยถูกกว่า ฿X/ชิ้น"
  - Only one side known: just show prices
- **Summary at top:** total if bought at the cheapest shops (KRW + THB), total saving vs Thailand (items that have both prices), and the count of bought items out of all items.
- **Fast entry:**
  - "＋ เพิ่มของ" puts an inline form at the top (name, plus optional Thai price and qty). Enter saves.
  - "＋ ราคาร้าน" on a card opens an inline row: store (text with suggestions from the app's shops and stores already used) and ₩ amount (numeric keypad). The store defaults to the **last store used**, so in a shop you only type amounts. *(my call)*
  - Tap a price to edit it or delete it. Deleting an item has undo.
- **Flexible editing (user):**
  - Items: add any time; edit name, qty and Thai price inline any time; 🗑 delete with undo.
  - Prices: add many per item; tap to edit store or amount; delete per row with undo.
  - "ลบรายการที่ซื้อแล้ว" (clear bought) with a confirm and undo.
- **Order:** not-bought items first, in the order they were added. Bought items go to the bottom, dimmed.
- **Storage:** localStorage `stp.v1.shop`, validated on load (bad entries dropped), capped at 200 items and 20 prices per item.

## Non-goals
Syncing or sharing, photos, tax refund calculation, currencies other than KRW and THB, price history.

## Left to builder
Exact styling (follow the converter's minimal look), and input validation messages.
