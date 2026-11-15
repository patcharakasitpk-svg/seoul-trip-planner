# Accounts + shared trip (Firebase) — design

Date: 2026-11-15 · Trip: 30 Nov – 6 Dec 2026 (15 days away)

## Intent

The owner has planned the Seoul trip alone in their browser. They now want
friends who are going on the trip to log in, see the same plan and the same
"own places", and edit/add together. The owner decides who gets in by
inviting their e-mail address. Some data stays personal to each account.

Keycloak was the first idea; the owner chose the free managed route
(Firebase) instead so it is ready before the trip, with no server to run.
Keycloak may come later — not part of this work.

## What is shared vs personal

Shared by everyone in the trip (view + edit + add):

- the plan: every day (date, day name, start/end place & time, stops,
  meals, notes, lock times, travel overrides) — pages แผนของฉัน, จัดแผน, วันนี้
- check-in times on the วันนี้ page (Day.actual) — we travel together, so
  "ถึงแล้ว" by anyone moves everyone's remaining schedule (owner did not
  object when proposed)
- own places (เพิ่มสถานที่ page): name, category, area, location, notes,
  links, photos, added-by name
- plan-level extras that change the shared schedule: coordOverrides,
  stayOverrides

Personal to each account (follows the account to every device, never shown
to friends):

- สิ่งของที่ต้องใช้ (packing list) — currently stored inside the plan; must
  move out
- แปลงเงิน: rate settings, and ของที่จะซื้อ (shopping list incl. its photos)

Other plan fields (builder's question, settled as **design calls**):

- `name` (plan name) → shared, it is the trip name.
- `saved`, `coldLevel`, `checklist`, `extraChecklist` (favourites, cold
  sensitivity, per-day clothing ticks) → personal, like packing.

## Goals

1. Sign in with Google (primary) or an e-mail sign-in link (fallback).
2. Owner invites by e-mail address; only invited addresses can join.
   Optionally the app sends the invitee a sign-in e-mail.
3. All members see changes from others live (seconds), on laptop and phone.
4. The trip works offline on the phone during travel (read the plan, tick
   check-ins); edits sync when back online.
5. The owner's current plan (7 days + 4–5 own places + photos) moves into the
   shared trip without loss. Packing / shopping / fx move into the owner's
   account.
6. Stays free (Firebase Spark plan, no credit card).

## Non-goals

- Keycloak, custom auth server, roles beyond owner/member (no view-only role).
- Multiple trips per account in the UI (data model allows it later).
- Real-time co-editing of the same day field-by-field (see conflict rule).
- Push notifications.

## Anti-goals (would make this a failure even if it "works")

- Anyone without an invite can read or change the trip (the earlier
  link-only RTDB sharing must not remain as a back door).
- Losing the owner's existing plan, own places or their photos during
  migration.
- The phone can't show today's plan without signal in Seoul.
- A friend sees the owner's packing or shopping list.

## Constraints

- Hosting stays GitHub Pages (static Vite + TS app, `npm run deploy`).
  Firebase web config is public; security comes only from Auth + Security
  Rules.
- Spark plan: no Cloud Functions; Cloud Storage for Firebase may require
  Blaze → store photos as Firestore documents (base64 JPEG, resized so each
  doc < ~700 KB; Firestore doc limit 1 MiB). E-mail-link sign-in has a low
  daily send quota on Spark — Google sign-in is the main path.
- UI language is Thai; existing look and components are kept.
- Existing validation (`validatePlan`, `customPlace`, `cleanPacking`,
  `cleanLinks`) must be applied to everything read from Firestore — it is
  external data.
- No Java on the dev machine today; Firebase emulators need Java (see
  Testing).

## Approaches considered

1. **Keycloak + own API + database** — owner's first idea. Needs an always-on
   server (Keycloak ~1 GB RAM, plus an API and DB), SMTP for invites, and
   ops. Not free; too heavy for 15 days. Rejected for now.
2. **Supabase (Auth + Postgres)** — free, good permissions, but the built-in
   mailer only e-mails project members (needs a separate SMTP service for
   invites) and free projects pause after 7 days without use. Rejected.
3. **Firebase Auth + Firestore** — chosen. Free, Google sign-in and
   e-mail-link sign-in built in, Security Rules can check membership,
   web SDK has an offline cache and queues writes. Matches the earlier
   Firebase place-sharing work.

   Within Firebase, **Firestore over Realtime Database** (builder-level call,
   made here): Firestore's web SDK keeps data on disk (IndexedDB) and queues
   offline writes — RTDB's web SDK does not persist to disk. Per-document
   writes also give natural per-day / per-place granularity.

## Design

### Data model (Firestore)

```
trips/{tripId}
  name, ownerUid, ownerEmail, createdAt, updatedAt
  members: { [uid]: { email, name, joinedAt } }
  invites: [lowercased e-mail, ...]

trips/{tripId}/days/{dayId}       one Day (as today's Day type, validated)
                                   + updatedBy {uid,name}, updatedAt
trips/{tripId}/places/{placeId}   one own place (customPlace shape) + addedBy
trips/{tripId}/photos/{photoId}   { d: base64 JPEG, by: uid }
trips/{tripId}/meta/overrides     { coordOverrides, stayOverrides, dayOrder }

users/{uid}                       { name, activeTripId }
users/{uid}/private/packing       { items: PackItem[] }
users/{uid}/private/fx            { …fx store }
users/{uid}/private/shop          { …shop store (items, photo ids) }
users/{uid}/photos/{photoId}      { d: base64 }   shopping photos
```

`dayOrder` keeps the days in order; day docs are keyed by the existing
day ids so drafts, `todayDayId`, check-ins keep working.

### Security rules (outline)

- `trips/{t}`: read if member, or if signed-in user's verified e-mail is in
  `invites`. Create by any signed-in user (becomes owner). Update by owner;
  an invited user may only add **themself** to `members` (and nothing else).
- `trips/{t}/{sub}/{doc}`: read/write only if member.
- `users/{uid}/**`: only that uid.
- Everything else denied. The old RTDB `places/` and `rooms/` sharing is
  removed from the app and its rules locked down.

### Sign-in and invites

- Signed-out users keep today's local-only app (nothing breaks for someone
  who never signs in). A small "เข้าสู่ระบบ" in the top bar.
- Owner, first sign-in: offered "สร้างทริปจากแผนในเครื่องนี้" → uploads the
  current local plan (days, own places, overrides, own-place photos from
  IndexedDB) to a new trip; packing/fx/shop to `users/{uid}`. Shows a summary
  ("7 วัน · 5 สถานที่ · 2 รูป") before and after. Local data is kept as a
  backup copy, not deleted.
- Members page (in settings or a "สมาชิก" panel): list members and pending
  invites; owner adds an e-mail → saved to `invites`; button to send a
  sign-in link e-mail to that address (uses Firebase e-mail-link sign-in;
  falls back to "copy invite link" if the daily quota is hit). Owner can
  remove an invite or a member.
- Invitee signs in (Google or e-mail link) with the invited address → the
  app finds trips where their e-mail is invited → joins (adds self to
  `members`) → sees the trip. Invited e-mail must be verified (Google
  accounts and e-mail-link accounts both are).

### Existing data and other devices (design calls)

- The earlier link-only RTDB place sharing was never configured or deployed
  (no Firebase project exists yet), so there is no remote data to rescue;
  migration reads only the owner's device (localStorage + IndexedDB).
- Every user's first sign-in on a device merges that device's **personal**
  data into their account: packing (union; ticked if ticked anywhere), fx and
  shop (union by id). Running it again on another device is safe (idempotent),
  so packing done on the phone is not lost.
- Creating the trip from a local plan happens once, from the device the owner
  chooses (the laptop). A friend's own local plan is never merged into the
  trip; it stays on their device as a local backup, reachable from settings.
- A signed-in user with no trip and no invite sees: "ยังไม่มีทริป — สร้างทริป
  จากแผนในเครื่องนี้ หรือรอคำเชิญจากเพื่อน" and keeps using local mode.

### Whole-plan actions in trip mode (design call)

Import from link/JSON, templates "use for whole trip", "new plan" and
replace-plan would overwrite every day for everyone. In trip mode they are
**owner-only**, behind a confirm that names the effect ("แทนที่ทุกวันของ
ทริปที่แชร์กับ N คน"), with undo. Members don't see these buttons. Per-day
template use ("ใช้เป็นวันนั้น") stays available to everyone, since it only
touches one day and goes through the same conflict warning. Rules: members
may write day docs but only the owner may delete day docs or change
`dayOrder`.

### Sync behaviour

- Firestore persistent local cache (multi-tab) on; listeners on the active
  trip's days, places, overrides, and the user's personal docs. The app's
  in-memory `Plan` is assembled from these and validated.
- Writes: planner "ยืนยันแผนวันนี้" writes that one day doc; edits on other
  pages write the doc they touch; own-place edits write one place doc;
  check-ins write the day doc's `actual`.
- Conflict rule: last write wins per document. When confirming a planner
  draft, if the day doc changed remotely since the draft was opened, show
  "เพื่อน (ชื่อ) แก้วันนี้ไปแล้ว เวลา … — ดูของเพื่อน / บันทึกทับ".
  Day cards show "แก้ล่าสุดโดย … " small text.
- Offline: reads from cache; writes queued; a status line shows
  "ออฟไลน์ — จะส่งเมื่อมีสัญญาณ".
- Photos: uploaded once as a doc; each device caches them in IndexedDB as
  today (the existing place-photo store) after first download.

### What changes in existing code (orientation for the builder)

- `src/ui/app.ts` (store/persist) gains a "trip mode" source of truth next to
  localStorage mode.
- `src/storage/share.ts` link/JSON export keeps working (exports the current
  plan; packing no longer inside it).
- `Plan.packing` moves to the personal store; `cleanPacking` reused.
- Remove `src/services/placesRoom.ts`, `src/ui/placesShare.ts`, the
  RTDB `RoomSync` plan room, and `SYNC_DB_URL`.
- Firebase web config via `VITE_FIREBASE_*` env at build.

## Testing

- Unit: mapping Plan ⇄ Firestore docs, validation of remote docs, migration
  summary, conflict detection.
- Security rules: tests with `@firebase/rules-unit-testing` against the
  Firestore emulator. Emulator needs Java → install a JDK (e.g. Temurin via
  Homebrew) on the dev machine; this is the recommended path. If Java cannot
  be installed, test rules against a separate throwaway Firebase project.
- E2E (Playwright): two browser contexts (owner, friend) against the
  emulators: sign in, migrate, invite, join, live edit both ways, offline
  check-in then reconnect, friend cannot see owner's packing, uninvited user
  is denied.
- Manual check on the real project before deploy with the owner's real data
  (backup JSON at `~/Documents/seoul-trip-planner-backups/`).

## Owner's one-time setup (guided at build time)

Create Firebase project → enable Authentication (Google + E-mail link) →
add `patcharakasitpk-svg.github.io` to authorized domains → create Firestore
(asia-southeast1) → publish rules from the repo → register a Web app and give
the config values.

## Left to the builder

- Exact UI layout of the sign-in button, members panel and migration dialog
  (follow the existing minimal style; Thai copy).
- Photo resize size (keep docs well under 1 MiB).
- Whether the shopping-list photos sync in the first release or follow
  shortly after (packing and fx must sync).
- How to structure the code (new modules vs extending app.ts).
