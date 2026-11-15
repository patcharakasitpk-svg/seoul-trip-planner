import { esc } from './util';
import { safeGet, safeSet } from '../storage/storage';
import { authAvailable, authState, onAuth, signInWithGoogle, sendEmailLink, isEmailLinkReturn, rememberedEmail, finishEmailLink, signOutUser, inAppBrowser, type AuthUser } from '../services/auth';
import { TRIP_DATES } from '../config';
import { fmtDateTh } from '../core/time';

/**
 * หน้าเข้าสู่ระบบ (เต็มจอ) + หน้าบัญชี (เมื่อเข้าสู่ระบบแล้ว)
 * - เปิดเองครั้งแรกถ้ายังไม่เคยเลือก "ใช้ต่อแบบไม่เข้าสู่ระบบ"
 * - เปิดจากปุ่มบนแถบเมนู
 */

const SKIP_KEY = 'stp.v1.loginSkipped';
type View = 'start' | 'sent' | 'confirm';
let root: HTMLElement | null = null;
let open = false;
let view: View = 'start';
let busy: '' | 'google' | 'email' | 'confirm' | 'out' = '';
let error = '';
let email = '';
let afterChange: () => void = () => {};

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

export function initLogin(el: HTMLElement, onChange: () => void) {
  root = el;
  afterChange = onChange;
  root.addEventListener('click', onClick);
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'email') email = t.value;
  });
  root.addEventListener('submit', onSubmit);
  onAuth((s) => {
    // เข้าสู่ระบบสำเร็จ → ปิดหน้า (ยกเว้นเปิดดูบัญชีอยู่)
    if (s.status === 'signed-in' && view !== 'start') view = 'start';
    if (s.status === 'signed-in' && open && busy) open = false;
    busy = '';
    if (s.status === 'signed-out' && isEmailLinkReturn()) {
      open = true;
      const remembered = rememberedEmail();
      if (remembered) void confirmLink(remembered);
      else view = 'confirm';
    } else if (s.status === 'signed-out' && !safeGet(SKIP_KEY)) open = true;
    render();
    afterChange();
  });
}

export function openLogin() {
  open = true;
  error = '';
  if (view === 'sent' && authState().status === 'signed-in') view = 'start';
  render();
}

export const loginOpen = () => open;

function close(skip = false) {
  if (skip) safeSet(SKIP_KEY, '1');
  open = false;
  error = '';
  view = 'start';
  render();
}

/** ปุ่มบัญชีบนแถบเมนู */
export function accountButtonHtml(): string {
  if (!authAvailable()) return '';
  const s = authState();
  if (s.status === 'loading') return '';
  if (s.status !== 'signed-in') return '<button class="top-link account-in" data-act="open-login">เข้าสู่ระบบ</button>';
  return `<button class="account-btn" data-act="open-login" aria-label="บัญชีของฉัน (${esc(s.user.email ?? '')})" title="${esc(s.user.email ?? '')}">${avatar(s.user, 30)}</button>`;
}

function avatar(u: AuthUser, size: number): string {
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  return u.photo
    ? `<img class="avatar" src="${esc(u.photo)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="avatar" style="width:${size}px;height:${size}px">${esc(initial)}</span>`;
}

function render() {
  if (!root) return;
  root.hidden = !open;
  document.body.classList.toggle('login-open', open);
  if (!open) {
    root.innerHTML = '';
    return;
  }
  const s = authState();
  const trip = `${fmtDateTh(TRIP_DATES.start).replace(/ \d{4}$/, '')} – ${fmtDateTh(TRIP_DATES.end)}`;
  let body = '';
  if (s.status === 'signed-in') {
    body = `
      <div class="lg-account">${avatar(s.user, 56)}<div><b>${esc(s.user.name || s.user.email || '')}</b>${s.user.name ? `<span class="muted">${esc(s.user.email ?? '')}</span>` : ''}</div></div>
      <p class="lg-note">เข้าสู่ระบบแล้ว · การแชร์ทริปกับเพื่อนจะเปิดในขั้นถัดไป — ตอนนี้แผนยังอยู่ในเครื่องนี้เหมือนเดิม</p>
      <button class="lg-btn" data-lg="signout" ${busy ? 'disabled' : ''}>${busy === 'out' ? 'กำลังออก…' : 'ออกจากระบบ'}</button>
      <button class="lg-link" data-lg="close">กลับไปที่แอป</button>`;
  } else if (view === 'sent') {
    body = `
      <div class="lg-sent"><div class="lg-mail" aria-hidden="true">✉</div>
      <h2>เช็กอีเมลของคุณ</h2>
      <p>ส่งลิงก์เข้าสู่ระบบไปที่ <b>${esc(email)}</b> แล้ว<br>เปิดอีเมลแล้วกดลิงก์ <b>ในเครื่องนี้</b> เพื่อเข้าสู่ระบบ</p>
      <p class="muted small">ไม่เห็นอีเมล? ดูในโฟลเดอร์ Spam/Promotions · ลิงก์ใช้ได้ครั้งเดียว</p></div>
      <button class="lg-link" data-lg="back">ใช้อีเมลอื่น / กลับ</button>`;
  } else if (view === 'confirm') {
    body = `
      <h2 class="lg-h">ยืนยันอีเมล</h2>
      <p class="muted">คุณเปิดลิงก์จากอีเมลในเครื่องที่ไม่ได้ขอลิงก์ — พิมพ์อีเมลเดิมอีกครั้งเพื่อเข้าสู่ระบบ</p>
      <form class="lg-form" data-lg-form="confirm"><input class="inp" type="email" name="email" value="${esc(email)}" placeholder="you@example.com" autocomplete="email" required data-autofocus><button class="lg-btn primary" ${busy ? 'disabled' : ''}>${busy === 'confirm' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button></form>`;
  } else {
    const inApp = inAppBrowser();
    body = `
      <p class="lg-lead">เข้าสู่ระบบเพื่อดูและแก้แผนร่วมกับเพื่อนที่ได้รับเชิญ</p>
      ${inApp ? `<p class="lg-warn">กำลังเปิดในแอป ${esc(inApp)} — เข้าสู่ระบบด้วย Google อาจไม่ได้ แนะนำให้กด ⋯ แล้วเลือก “เปิดใน Safari/Chrome”</p>` : ''}
      <button class="lg-btn google" data-lg="google" ${busy ? 'disabled' : ''}>${GOOGLE_G}<span>${busy === 'google' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วย Google'}</span></button>
      <div class="lg-or"><span>หรือ</span></div>
      <form class="lg-form" data-lg-form="email">
        <label for="lg-email">อีเมล</label>
        <input id="lg-email" class="inp" type="email" name="email" value="${esc(email)}" placeholder="you@example.com" autocomplete="email" required enterkeyhint="send">
        <button class="lg-btn" ${busy ? 'disabled' : ''}>${busy === 'email' ? 'กำลังส่ง…' : 'ส่งลิงก์เข้าสู่ระบบทางอีเมล'}</button>
      </form>
      <button class="lg-link" data-lg="skip">ใช้ต่อแบบไม่เข้าสู่ระบบ <span class="muted">(แผนอยู่ในเครื่องนี้เท่านั้น)</span></button>`;
  }
  root.innerHTML = `
    <div class="lg-card" role="dialog" aria-modal="true" aria-label="เข้าสู่ระบบ">
      <header class="lg-brand"><b>Seoul Trip</b><span class="muted">ทริปโซล ${esc(trip)}</span></header>
      ${body}
      ${error ? `<p class="lg-error" role="alert">${esc(error)}</p>` : ''}
    </div>`;
  (root.querySelector('[data-autofocus]') as HTMLInputElement | null)?.focus();
}

async function confirmLink(addr: string) {
  busy = 'confirm';
  render();
  error = await finishEmailLink(addr);
  busy = '';
  if (error) view = 'confirm';
  render();
}

async function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-lg]') as HTMLElement | null;
  if (!el) return;
  switch (el.dataset.lg) {
    case 'google':
      busy = 'google';
      error = '';
      render();
      error = await signInWithGoogle();
      if (error || authState().status !== 'signed-in') busy = '';
      render();
      return;
    case 'skip':
      close(true);
      afterChange();
      return;
    case 'close':
      close();
      return;
    case 'back':
      view = 'start';
      error = '';
      render();
      return;
    case 'signout':
      busy = 'out';
      render();
      await signOutUser();
      safeSet(SKIP_KEY, '1'); // ออกแล้วไม่ต้องเด้งหน้าเข้าสู่ระบบทุกครั้ง
      close();
      afterChange();
      return;
  }
}

async function onSubmit(e: Event) {
  const f = e.target as HTMLFormElement;
  const kind = f.dataset.lgForm;
  if (!kind) return;
  e.preventDefault();
  email = String(new FormData(f).get('email') ?? '').trim();
  error = '';
  if (kind === 'email') {
    busy = 'email';
    render();
    error = await sendEmailLink(email);
    busy = '';
    if (!error) view = 'sent';
    render();
  } else {
    await confirmLink(email);
  }
}
