import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, deleteField } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = { uid: 'owner', email: 'owner@example.com' };
const FRIEND = { uid: 'friend', email: 'friend@example.com' };
const STRANGER = { uid: 'stranger', email: 'stranger@example.com' };
const as = (u: { uid: string; email: string }, verified = true) => env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore();

const trip = (over: Record<string, unknown> = {}) => ({
  name: 'แผนเที่ยวโซล',
  ownerUid: OWNER.uid,
  ownerEmail: OWNER.email,
  memberUids: [OWNER.uid],
  members: { [OWNER.uid]: { email: OWNER.email, name: 'Owner' } },
  invites: [] as string[],
  ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'trips/t1'), trip({ invites: ['friend@example.com'] }));
    await setDoc(doc(c.firestore(), 'trips/t1/days/d1'), { day: { id: 'd1' } });
    await setDoc(doc(c.firestore(), 'users/owner/private/packing'), { items: [] });
  });
});

describe('สร้างทริป', () => {
  it('ผู้ใช้ที่เข้าสู่ระบบสร้างทริปของตัวเองได้ · สร้างในนามคนอื่น/ใส่สมาชิกคนอื่นไม่ได้ · ไม่เข้าสู่ระบบไม่ได้', async () => {
    await assertSucceeds(setDoc(doc(as(FRIEND), 'trips/t2'), trip({ ownerUid: FRIEND.uid, memberUids: [FRIEND.uid], members: { [FRIEND.uid]: { email: FRIEND.email } } })));
    await assertFails(setDoc(doc(as(FRIEND), 'trips/t3'), trip()));
    await assertFails(setDoc(doc(as(FRIEND), 'trips/t4'), trip({ ownerUid: FRIEND.uid, memberUids: [FRIEND.uid, STRANGER.uid], members: { [FRIEND.uid]: {} } })));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'trips/t5'), trip()));
  });
});

describe('ได้รับเชิญ → เข้าร่วม', () => {
  it('ผู้ได้รับเชิญหาทริปจากอีเมลได้ แต่ยังอ่านวันในแผนไม่ได้จนกว่าจะเข้าร่วม', async () => {
    const db = as(FRIEND);
    const q = await assertSucceeds(getDocs(query(collection(db, 'trips'), where('invites', 'array-contains', 'friend@example.com'))));
    if (q.size !== 1) throw new Error('ควรเจอ 1 ทริป');
    await assertFails(getDoc(doc(db, 'trips/t1/days/d1')));
  });
  it('อีเมลยังไม่ยืนยัน = หาไม่เจอ', async () => {
    await assertFails(getDoc(doc(as(FRIEND, false), 'trips/t1')));
  });
  it('เข้าร่วม: เพิ่มตัวเองได้ แล้วอ่าน/เขียนวันได้', async () => {
    const db = as(FRIEND);
    await assertSucceeds(updateDoc(doc(db, 'trips/t1'), { memberUids: arrayUnion(FRIEND.uid), [`members.${FRIEND.uid}`]: { email: FRIEND.email, name: 'Friend' }, invites: arrayRemove(FRIEND.email) }));
    await assertSucceeds(getDoc(doc(db, 'trips/t1/days/d1')));
    await assertSucceeds(setDoc(doc(db, 'trips/t1/days/d1'), { day: { id: 'd1', title: 'เพื่อนแก้' } }));
    await assertSucceeds(setDoc(doc(db, 'trips/t1/places/custom-a'), { nameTh: 'ร้านของเพื่อน' }));
  });
  it('ผู้ได้รับเชิญเพิ่มคนอื่น/แก้รายชื่อเชิญ/เปลี่ยนเจ้าของไม่ได้', async () => {
    const db = as(FRIEND);
    await assertFails(updateDoc(doc(db, 'trips/t1'), { memberUids: arrayUnion(FRIEND.uid, STRANGER.uid), [`members.${FRIEND.uid}`]: {}, invites: arrayRemove(FRIEND.email) }));
    await assertFails(updateDoc(doc(db, 'trips/t1'), { invites: arrayUnion('x@example.com') }));
    await assertFails(updateDoc(doc(db, 'trips/t1'), { ownerUid: FRIEND.uid }));
  });
  it('คนที่ไม่ได้รับเชิญ: อ่าน/เข้าร่วม/เขียนไม่ได้เลย', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, 'trips/t1')));
    await assertFails(updateDoc(doc(db, 'trips/t1'), { memberUids: arrayUnion(STRANGER.uid), [`members.${STRANGER.uid}`]: {} }));
    await assertFails(getDoc(doc(db, 'trips/t1/days/d1')));
    await assertFails(setDoc(doc(db, 'trips/t1/places/custom-x'), { nameTh: 'x' }));
    await assertFails(getDocs(query(collection(db, 'trips'), where('invites', 'array-contains', 'friend@example.com'))));
  });
});

describe('สิทธิ์ของสมาชิก vs เจ้าของ', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'trips/t1'), trip({ memberUids: [OWNER.uid, FRIEND.uid], members: { [OWNER.uid]: {}, [FRIEND.uid]: {} } }));
    });
  });
  it('สมาชิกลบวัน/แก้ลำดับวัน/เชิญคนเพิ่มไม่ได้ · เจ้าของทำได้', async () => {
    await assertFails(deleteDoc(doc(as(FRIEND), 'trips/t1/days/d1')));
    await assertFails(setDoc(doc(as(FRIEND), 'trips/t1/meta/order'), { dayOrder: [] }));
    await assertFails(updateDoc(doc(as(FRIEND), 'trips/t1'), { invites: arrayUnion('x@example.com') }));
    await assertSucceeds(setDoc(doc(as(FRIEND), 'trips/t1/meta/overrides'), { coordOverrides: {} }));
    await assertSucceeds(updateDoc(doc(as(OWNER), 'trips/t1'), { invites: arrayUnion('x@example.com') }));
    await assertSucceeds(setDoc(doc(as(OWNER), 'trips/t1/meta/order'), { dayOrder: ['d1'] }));
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'trips/t1/days/d1')));
  });
  it('เจ้าของเอาสมาชิกออกได้ → สมาชิกคนนั้นอ่านต่อไม่ได้', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), 'trips/t1'), { memberUids: arrayRemove(FRIEND.uid), [`members.${FRIEND.uid}`]: deleteField() }));
    await assertFails(getDoc(doc(as(FRIEND), 'trips/t1/days/d1')));
  });
  it('สมาชิกออกจากทริปเองได้ แต่เอาคนอื่นออกไม่ได้', async () => {
    await assertFails(updateDoc(doc(as(FRIEND), 'trips/t1'), { memberUids: arrayRemove(OWNER.uid), [`members.${OWNER.uid}`]: deleteField() }));
    await assertSucceeds(updateDoc(doc(as(FRIEND), 'trips/t1'), { memberUids: arrayRemove(FRIEND.uid), [`members.${FRIEND.uid}`]: deleteField() }));
  });
  it('รูปใหญ่เกินถูกปฏิเสธ', async () => {
    await assertSucceeds(setDoc(doc(as(FRIEND), 'trips/t1/photos/ph1'), { d: 'x'.repeat(1000) }));
    await assertFails(setDoc(doc(as(FRIEND), 'trips/t1/photos/ph2'), { d: 'x'.repeat(950000) }));
  });
});

describe('ของส่วนตัว', () => {
  it('เพื่อนในทริปเดียวกันอ่านเช็กลิสต์ของเจ้าของไม่ได้', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'users/owner/private/packing')));
    await assertFails(getDoc(doc(as(FRIEND), 'users/owner/private/packing')));
    await assertFails(setDoc(doc(as(FRIEND), 'users/owner/private/packing'), { items: [] }));
  });
});
