# Shared trip on Firebase — implementation plan

Spec: docs/superpowers/specs/2026-11-15-accounts-shared-trip-design.md
Done already: login page + Firebase Auth (commit 420e9d6), Firebase project
`travel-planner-507112`, Firestore asia-southeast1 with deny-all rules.

Approach (builder call): keep the app's in-memory Plan + localStorage as the
working copy; a TripSync controller mirrors it to Firestore by diffing per
document after every persist, and applies remote snapshots back with
`app.commit`. Firestore's persistent cache gives offline reads/queued writes.
Existing UI code stays unchanged except for the pieces below.

## Global constraints
- Free Spark plan only; photos as Firestore docs `{d: base64}` (< 700 KB).
- Everything read from Firestore goes through `validatePlan`/`customPlace`/
  `cleanPacking`.
- Personal: packing, coldLevel, checklist, extraChecklist, saved, shop, fx.
  Shared: days (incl. actual), customPlaces (+ photos), coordOverrides,
  stayOverrides, plan name.
- Tests: `npm test`, `npm run test:e2e`, rules tests under the Firestore
  emulator (Java at /opt/homebrew/opt/openjdk@21/bin).

## Tasks
1. **Rules** — `firestore.rules` per spec (members/memberUids/invites,
   self-join, owner-only day delete & dayOrder, users/{uid} private) +
   `tests/rules/*.test.ts` with `@firebase/rules-unit-testing` run by
   `firebase emulators:exec --only firestore`.
2. **Mapping (pure)** — `src/core/tripDocs.ts`: plan → doc set
   (days, places, meta, personal), docs → plan (validated), diff old/new →
   write ops. Unit tests.
3. **TripSync service** — `src/services/tripSync.ts` (firebase/firestore,
   lazy): create trip from local plan (+ photos, personal), find invites,
   join, listen (trip, days, places, meta, user private), apply remote,
   push diffs on persist, photo upload/download, status.
4. **UI** — account page trip section (create / invited / members, invite by
   e-mail + send sign-in link, remove, leave), sync status in top bar,
   planner confirm conflict warning, "แก้ล่าสุดโดย" on day cards, owner-only
   whole-plan actions.
5. **E2E with emulators** — owner creates trip, invites, friend joins, live
   edits both ways, packing stays personal, uninvited user denied, offline
   edit then reconnect.
6. **Cleanup** — remove placesRoom/placesShare, RoomSync and SYNC_DB_URL.
7. **Deploy** — rules to real project, manual check with owner's real data,
   then `npm run deploy` on owner's go.
