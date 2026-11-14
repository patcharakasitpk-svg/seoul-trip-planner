# Today view: live trip mode (หน้า "วันนี้" ระหว่างเดินทาง)

## Intent
On the phone during the trip, the user should see at a glance: where they are, where they go next, how to get there, how long the trip takes, how long they can stay, and whether today still fits the schedule. The view should match real life (late, early, long queues) and be easy to read.

## Decisions (user)
- Real-life tracking with check-ins: **"✓ ถึงแล้ว" / "✓ ออกแล้ว"**, then re-time the rest of the day from the actual times. (approved)
- Easy to see and understand, mobile first.

## Design (my calls, the user said go ahead)
- **Data:** `Day.actual: Record<key, { a?: 'HH:MM'; d?: 'HH:MM' }>`. The key is the stop uid, `__start` (left the start place) or `__end` (arrived at the end place). It lives in the plan, so a synced friend sees progress, and it is validated like other plan fields.
- **Schedule:** `computeSchedule(day, ctx)` gains optional `ctx.live = { now: number; estimate: (fromId, toId, mode) => number | null }`.
  - Actual times override the planned ones. A known actual time clears "lower bound" uncertainty.
  - A stop that is arrived but not departed gets `depart = max(start + stay, now)`. Overstaying pushes the rest of the day later.
  - Legs with no data use the distance estimate. Source is `'auto'`, and the time is shown as "≈" (live mode only; the plan view is unchanged).
- **Today screen:**
  - Header: date, Seoul time, and a day picker so the user can rehearse any day before the trip.
  - Hero card by phase:
    - `ready`: "เริ่มวัน", start place and time, button **▶ ออกเดินทาง**.
    - `moving`: "กำลังไป X", arrive ~HH:MM, travel ≈ N min, subway hint, Naver/Google buttons, big **✓ ถึงแล้ว**.
    - `at`: "ตอนนี้อยู่ X", "อยู่ได้อีก N นาที · ออก HH:MM", progress bar, big **✓ ออกแล้ว**, then the next stop with how to get there.
    - `returning`: "กลับ {end}", **✓ ถึงที่พักแล้ว**.
    - `done`: "จบวันนี้".
  - Red alert when a locked appointment ahead would be missed: "ไม่ทัน X HH:MM (สาย N นาที)".
  - Compact timeline: time, name, stay length, travel before, with ✓ done, ● now and 🔒 locked markers. The last row is the return with ทัน/เกิน.
  - Every check-in has undo. There is also a "ล้างเวลาจริงวันนี้" link.
- **Non-goals:** GPS auto check-in, notifications.
