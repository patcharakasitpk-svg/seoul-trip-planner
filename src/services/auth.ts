import { FIREBASE_CONFIG, FIREBASE_AUTH_EMULATOR } from '../config';
import { safeGet, safeSet } from '../storage/storage';
import type { Auth, User } from 'firebase/auth';

/**
 * เข้าสู่ระบบด้วย Firebase Auth: Google (หลัก) หรือ ลิงก์ทางอีเมล (สำรอง)
 * โหลด SDK แบบ lazy เฉพาะเมื่อตั้งค่า Firebase แล้ว
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  photo: string | null;
}
export type AuthState = { status: 'unconfigured' } | { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; user: AuthUser };

const EMAIL_KEY = 'stp.v1.emailForSignIn';
let auth: Auth | null = null;
let mod: typeof import('firebase/auth') | null = null;
let state: AuthState = FIREBASE_CONFIG ? { status: 'loading' } : { status: 'unconfigured' };
const listeners = new Set<(s: AuthState) => void>();

export const authAvailable = () => !!FIREBASE_CONFIG;
export const authState = () => state;
export function onAuth(fn: (s: AuthState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const setState = (s: AuthState) => {
  state = s;
  listeners.forEach((f) => f(s));
};
const toUser = (u: User): AuthUser => ({ uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL });

export async function initAuth(): Promise<void> {
  if (!FIREBASE_CONFIG || auth) return;
  const [{ initializeApp }, m] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  mod = m;
  const app = initializeApp(FIREBASE_CONFIG);
  auth = m.initializeAuth(app, { persistence: [m.indexedDBLocalPersistence, m.browserLocalPersistence], popupRedirectResolver: m.browserPopupRedirectResolver });
  auth.languageCode = 'th';
  if (FIREBASE_AUTH_EMULATOR) m.connectAuthEmulator(auth, FIREBASE_AUTH_EMULATOR, { disableWarnings: true });
  m.onAuthStateChanged(auth, (u) => setState(u ? { status: 'signed-in', user: toUser(u) } : { status: 'signed-out' }));
}

/** ข้อความภาษาไทยจากรหัสข้อผิดพลาดของ Firebase */
export function authErrorText(code: string): string {
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return '';
  if (code.includes('popup-blocked')) return 'เบราว์เซอร์บล็อกหน้าต่างเข้าสู่ระบบ — อนุญาตป๊อปอัป แล้วลองอีกครั้ง';
  if (code.includes('network-request-failed')) return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ — ลองใหม่เมื่อมีสัญญาณ';
  if (code.includes('invalid-email') || code.includes('missing-email')) return 'อีเมลไม่ถูกต้อง';
  if (code.includes('quota-exceeded')) return 'ส่งอีเมลเข้าสู่ระบบครบจำนวนของวันนี้แล้ว — ใช้ “เข้าสู่ระบบด้วย Google” แทน';
  if (code.includes('unauthorized-domain') || code.includes('unauthorized-continue-uri')) return 'เว็บนี้ยังไม่ได้รับอนุญาตใน Firebase (Authorized domains)';
  if (code.includes('invalid-action-code') || code.includes('expired-action-code')) return 'ลิงก์เข้าสู่ระบบหมดอายุหรือใช้ไปแล้ว — ขอลิงก์ใหม่';
  if (code.includes('operation-not-allowed')) return 'ยังไม่ได้เปิดวิธีเข้าสู่ระบบนี้ใน Firebase';
  if (code.includes('web-storage-unsupported') || code.includes('operation-not-supported-in-this-environment')) return 'เบราว์เซอร์นี้เข้าสู่ระบบไม่ได้ — เปิดใน Safari หรือ Chrome';
  return `เข้าสู่ระบบไม่สำเร็จ (${code})`;
}
const codeOf = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : String(e));

export async function signInWithGoogle(): Promise<string> {
  if (!auth || !mod) return 'ยังไม่พร้อม — ลองอีกครั้ง';
  try {
    const p = new mod.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    await mod.signInWithPopup(auth, p);
    return '';
  } catch (e) {
    return authErrorText(codeOf(e));
  }
}

/** ลิงก์กลับมาที่หน้าเดิมของเว็บ (ไม่มี # และ query) */
const continueUrl = () => `${location.origin}${location.pathname}`;

export async function sendEmailLink(email: string): Promise<string> {
  if (!auth || !mod) return 'ยังไม่พร้อม — ลองอีกครั้ง';
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'อีเมลไม่ถูกต้อง';
  try {
    await mod.sendSignInLinkToEmail(auth, e, { url: continueUrl(), handleCodeInApp: true });
    safeSet(EMAIL_KEY, e);
    return '';
  } catch (err) {
    return authErrorText(codeOf(err));
  }
}

/** เปิดเว็บจากลิงก์ในอีเมลไหม */
export function isEmailLinkReturn(href = location.href): boolean {
  return !!(auth && mod && mod.isSignInWithEmailLink(auth, href));
}
export const rememberedEmail = () => safeGet(EMAIL_KEY);

/** ทำการเข้าสู่ระบบจากลิงก์ในอีเมลให้เสร็จ (ต้องรู้อีเมล — ถ้าเปิดลิงก์คนละเครื่องให้ผู้ใช้พิมพ์ยืนยัน) */
export async function finishEmailLink(email: string, href = location.href): Promise<string> {
  if (!auth || !mod) return 'ยังไม่พร้อม — ลองอีกครั้ง';
  try {
    await mod.signInWithEmailLink(auth, email.trim().toLowerCase(), href);
    safeSet(EMAIL_KEY, '');
    history.replaceState(null, '', continueUrl());
    return '';
  } catch (e) {
    return authErrorText(codeOf(e));
  }
}

export async function signOutUser(): Promise<void> {
  if (auth && mod) await mod.signOut(auth);
}

/** เปิดในแอป LINE / Instagram / Facebook (เข้าสู่ระบบด้วย Google มักใช้ไม่ได้) */
export function inAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string | null {
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  return null;
}
