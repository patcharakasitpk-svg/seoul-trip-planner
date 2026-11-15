import { esc } from './util';
import loginBg from '../assets/login-bg.jpg';
import logoUrl from '../assets/logo.png';
import { safeGet, safeSet } from '../storage/storage';
import { authAvailable, authState, onAuth, signInWithGoogle, sendEmailLink, isEmailLinkReturn, rememberedEmail, finishEmailLink, signOutUser, inAppBrowser, type AuthUser } from '../services/auth';
import { TRIP_DATES } from '../config';
import { fmtDateTh } from '../core/time';
import { app } from './app';
import { tripState, createTripFromLocal, joinTrip, invite, uninvite, removeMember, refreshLists, activate, signedInUser } from '../services/tripSync';

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
    if (t.id === 'lg-inv') inviteDraft = t.value;
    else if (t.name === 'email') email = t.value;
  });
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.hasAttribute('data-lg-send')) sendMail = (t as HTMLInputElement).checked;
    if (t.hasAttribute('data-lg-trip')) {
      activate(t.value);
      render();
    }
  });
  onAuth((s) => {
    // เข้าสู่ระบบสำเร็จ → ปิดหน้า (ยกเว้นเปิดดูบัญชีอยู่)
    if (s.status === 'signed-in' && view !== 'start') view = 'start';
    // เพิ่งเข้าสู่ระบบ: ค้างหน้าไว้จนรู้ว่าอยู่ในทริปไหม — อยู่แล้วค่อยปิดเอง · ยังไม่อยู่ → แสดงคำเชิญ/วิธีเข้าทริป
    if (s.status === 'signed-in' && open && busy) waitTrip = true;
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
/** อัปเดตหน้าบัญชีเมื่อสถานะทริปเปลี่ยน (ถ้าเปิดอยู่) */
export function refreshLogin() {
  if (!open) return;
  const t = tripState();
  if (waitTrip && t.status !== 'loading') {
    waitTrip = false;
    if (t.trip) {
      open = false;
      render();
      afterChange();
      return;
    }
  }
  render();
}

function close(skip = false) {
  if (skip) safeSet(SKIP_KEY, '1');
  open = false;
  error = '';
  note = '';
  view = 'start';
  render();
}

/** ปุ่มบัญชีบนแถบเมนู */
export function accountButtonHtml(): string {
  if (!authAvailable()) return '';
  const s = authState();
  if (s.status === 'loading') return '';
  if (s.status !== 'signed-in') return '<button class="top-link account-in" data-act="open-login">เข้าสู่ระบบ</button>';
  const t = tripState();
  const dot = !t.trip ? '' : !navigator.onLine ? 'offline' : t.status === 'error' ? 'error' : t.pending ? 'sending' : 'live';
  return `<button class="account-btn ${dot ? `dot-${dot}` : ''}" data-act="open-login" aria-label="บัญชีของฉัน (${esc(s.user.email ?? '')})" title="${esc(s.user.email ?? '')}">${avatar(s.user, 30)}</button>`;
}

function avatar(u: AuthUser, size: number): string {
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  return u.photo
    ? `<img class="avatar" src="${esc(u.photo)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="avatar" style="width:${size}px;height:${size}px">${esc(initial)}</span>`;
}

let note = '';
/** เพิ่งเข้าสู่ระบบ → ปิดหน้าเองเมื่อพบว่าอยู่ในทริปแล้ว */
let waitTrip = false;
let inviteDraft = '';
let sendMail = true;

/** ส่วนทริปที่แชร์ในหน้าบัญชี */
function tripSection(u: AuthUser): string {
  const t = tripState();
  if (t.status === 'loading' && !t.trip) return '<p class="lg-note">กำลังโหลดทริป…</p>';
  if (t.trip) {
    const trip = t.trip;
    const owner = trip.ownerUid === u.uid;
    const sync = !navigator.onLine ? '<span class="warn-text">ออฟไลน์ — จะส่งเมื่อมีสัญญาณ</span>' : t.status === 'error' ? `<span class="bad-text">${esc(t.error)}</span>` : t.pending ? `<span class="muted">กำลังส่ง ${t.pending} รายการ…</span>` : '<span class="ok-text">● ซิงก์แล้ว</span>';
    return `<section class="lg-trip">
      <div class="lg-trip-head"><b>${esc(trip.name)}</b><span class="small">${sync}</span></div>
      <p class="muted small">${owner ? 'คุณเป็นเจ้าของทริป' : `เจ้าของทริป: ${esc(trip.ownerEmail)}`} · ทุกคนในทริปเห็นและแก้แผน/สถานที่ได้ · สิ่งของที่ต้องใช้และแปลงเงินเป็นของแต่ละคน</p>
      <ul class="lg-members">${trip.members
        .map((m) => `<li>${esc(m.name || m.email)} <span class="muted small">${esc(m.email)}${m.uid === trip.ownerUid ? ' · เจ้าของ' : ''}${m.uid === u.uid ? ' · คุณ' : ''}</span>${owner && m.uid !== u.uid ? `<button class="lg-x" data-lg="remove" data-uid="${esc(m.uid)}" aria-label="เอา ${esc(m.email)} ออกจากทริป">เอาออก</button>` : ''}</li>`)
        .join('')}${trip.invites.map((e) => `<li class="pending">${esc(e)} <span class="muted small">รอเข้าร่วม</span>${owner ? `<button class="lg-x" data-lg="uninvite" data-email="${esc(e)}">ยกเลิก</button>` : ''}</li>`).join('')}</ul>
      ${
        owner
          ? `<form class="lg-form lg-invite" data-lg-form="invite"><label for="lg-inv">เชิญเพื่อนด้วยอีเมล</label><div class="lg-row"><input id="lg-inv" class="inp" type="email" name="email" value="${esc(inviteDraft)}" placeholder="friend@gmail.com" required enterkeyhint="send"><button class="lg-btn primary" ${t.busy ? 'disabled' : ''}>${t.busy === 'invite' ? 'กำลังเชิญ…' : 'เชิญ'}</button></div>
             <label class="lg-check"><input type="checkbox" name="send" ${sendMail ? 'checked' : ''} data-lg-send> ส่งอีเมลลิงก์เข้าสู่ระบบให้เพื่อนด้วย</label>
             <p class="muted small">เพื่อนเปิดเว็บแล้วเข้าสู่ระบบด้วยอีเมลที่เชิญ (Google หรือลิงก์อีเมล) จะเห็นปุ่ม “เข้าร่วม” · <button type="button" class="lg-inline" data-lg="copy-site">คัดลอกลิงก์เว็บ</button></p></form>`
          : '<button class="lg-btn" data-lg="leave">ออกจากทริปนี้</button>'
      }
      ${t.myTrips.length > 1 ? `<label class="lg-switch small">ทริปอื่นของฉัน <select class="inp sm" data-lg-trip>${t.myTrips.map((x) => `<option value="${esc(x.id)}" ${x.id === trip.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    </section>`;
  }
  const inv = t.invited.map((x) => `<div class="lg-invited"><div><b>${esc(x.name)}</b><span class="muted small">เชิญโดย ${esc(x.ownerEmail)}</span></div><button class="lg-btn primary" data-lg="join" data-id="${esc(x.id)}" ${t.busy ? 'disabled' : ''}>${t.busy === 'join' ? 'กำลังเข้าร่วม…' : 'เข้าร่วม'}</button></div>`).join('');
  const mine = t.myTrips.map((x) => `<button class="lg-btn" data-lg="open-trip" data-id="${esc(x.id)}">เปิดทริป ${esc(x.name)}</button>`).join('');
  const p = app.store.plans.find((x) => !x.id.startsWith('trip-')) ?? app.plan;
  const photos = p.customPlaces.reduce((n, c) => n + (c.photos?.length ?? 0), 0);
  const createBlock = `<div class="lg-create">
      <p class="muted small"><b>${esc(p.name)}</b> · ${p.days.length} วัน · สถานที่ที่เพิ่มเอง ${p.customPlaces.length} แห่ง${photos ? ` · รูป ${photos} รูป` : ''} — แผนในเครื่องยังเก็บไว้เป็นสำรอง แล้วค่อยเชิญเพื่อนด้วยอีเมล</p>
      <button class="lg-btn" data-lg="create" ${t.busy ? 'disabled' : ''}>${t.busy === 'create' ? 'กำลังสร้างทริป…' : 'สร้างทริปที่แชร์ได้'}</button>
    </div>`;
  if (t.status === 'loading') return '<section class="lg-trip"><p class="lg-note">กำลังตรวจทริปและคำเชิญ…</p></section>';
  return `<section class="lg-trip">
    ${inv ? `<p class="lg-sub">คุณได้รับเชิญเข้าทริป — กด “เข้าร่วม” เพื่อดูและแก้แผนเดียวกัน</p>${inv}` : ''}
    ${mine}
    ${t.error ? `<p class="lg-error">${esc(t.error)}</p>` : ''}
    ${
      !inv && !mine
        ? `<div class="lg-wait">
            <p class="lg-sub">ยังไม่ได้อยู่ในทริปไหน</p>
            <p class="small">ถ้าจะเข้าทริปของเพื่อน: ส่งอีเมลนี้ให้เจ้าของทริป แล้วให้เขากด <b>เชิญ</b> ในหน้าบัญชีของเขา — คำเชิญจะขึ้นที่หน้านี้เองทันที</p>
            <div class="lg-row"><input class="inp" readonly value="${esc(u.email ?? '')}" aria-label="อีเมลของคุณ"><button class="lg-btn primary" data-lg="copy-email">คัดลอกอีเมล</button></div>
            <button class="lg-inline small" data-lg="refresh">ตรวจคำเชิญอีกครั้ง</button>
          </div>`
        : ''
    }
    <details class="lg-create-more"><summary>${inv || mine ? 'หรือ ' : ''}สร้างทริปของตัวเองจากแผนในเครื่องนี้ (สำหรับเจ้าของทริป)</summary>${createBlock}</details>
  </section>`;
}

function render() {
  if (!root) return;
  root.hidden = !open;
  root.style.setProperty('--lg-bg', `url("${loginBg}")`);
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
      ${tripSection(s.user)}
      ${note ? `<p class="lg-ok" role="status">${esc(note)}</p>` : ''}
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
  const refocusInvite = document.activeElement?.id === 'lg-inv';
  root.innerHTML = `
    <div class="lg-card" role="dialog" aria-modal="true" aria-label="เข้าสู่ระบบ">
      <header class="lg-brand"><img class="lg-logo" src="${logoUrl}" alt="" width="64" height="64"><b>Travel planner</b><span class="muted">ทริปโซล ${esc(trip)}</span></header>
      ${body}
      ${error ? `<p class="lg-error" role="alert">${esc(error)}</p>` : ''}
    </div>`;
  if (refocusInvite) (root.querySelector('#lg-inv') as HTMLInputElement | null)?.focus();
  else (root.querySelector('[data-autofocus]') as HTMLInputElement | null)?.focus();
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
    case 'create': {
      note = '';
      const err = await createTripFromLocal();
      if (err) error = err;
      else note = 'สร้างทริปแล้ว — เชิญเพื่อนด้วยอีเมลด้านบนได้เลย';
      render();
      return;
    }
    case 'join': {
      const err = await joinTrip(el.dataset.id!);
      if (err) {
        error = err;
        render();
        return;
      }
      // เข้าร่วมแล้ว → กลับไปที่แอป หน้าแผนของฉัน (เห็นแผนของทริปทันที)
      app.tab = 'plan';
      close();
      afterChange();
      return;
    }
    case 'open-trip':
      activate(el.dataset.id!);
      close();
      return;
    case 'refresh':
      await refreshLists();
      render();
      return;
    case 'uninvite':
      error = await uninvite(el.dataset.email!);
      render();
      return;
    case 'remove':
      if (!confirm('เอาสมาชิกคนนี้ออกจากทริป? เขาจะดู/แก้ทริปนี้ไม่ได้อีก')) return;
      error = await removeMember(el.dataset.uid!);
      render();
      return;
    case 'leave': {
      const me = signedInUser();
      if (!me || !confirm('ออกจากทริปนี้? จะกลับไปใช้แผนในเครื่องนี้ (เข้าร่วมใหม่ได้ถ้าเจ้าของเชิญอีกครั้ง)')) return;
      error = await removeMember(me.uid);
      note = error ? '' : 'ออกจากทริปแล้ว';
      render();
      afterChange();
      return;
    }
    case 'copy-email': {
      const me = signedInUser();
      void navigator.clipboard?.writeText(me?.email ?? '').then(() => {
        note = 'คัดลอกอีเมลแล้ว — ส่งให้เจ้าของทริปเพื่อเชิญ';
        render();
      });
      return;
    }
    case 'copy-site':
      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}`).then(() => {
        note = 'คัดลอกลิงก์เว็บแล้ว — ส่งให้เพื่อน';
        render();
      });
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
  if (kind === 'invite') {
    const addr = String(new FormData(f).get('email') ?? '').trim();
    error = '';
    note = '';
    const err = await invite(addr, sendMail);
    if (err) error = err;
    else {
      inviteDraft = '';
      note = sendMail ? `เชิญ ${addr} แล้ว และส่งอีเมลลิงก์เข้าสู่ระบบให้แล้ว` : `เชิญ ${addr} แล้ว — บอกเพื่อนให้เข้าสู่ระบบด้วยอีเมลนี้`;
    }
    render();
    return;
  }
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
