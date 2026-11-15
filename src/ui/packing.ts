import { app } from './app';
import { esc } from './util';
import { uid } from '../core/planOps';
import { defaultPacking, packGroups, PACK_LIMITS, type PackItem } from '../core/packing';

/**
 * หน้า "สิ่งของที่ต้องใช้": เช็กลิสต์ของที่ต้องเตรียมไป
 * แตะทั้งแถว = ติ๊ก/เอาออก · เพิ่มของได้ในแต่ละหมวด · ลบได้ (เลิกทำได้) · ซ่อนของที่เตรียมแล้ว · ล้างเครื่องหมายเพื่อเช็กขากลับ
 */

let root: HTMLElement | null = null;
let hideDone = false;
/** ข้อความที่กำลังพิมพ์ในช่องเพิ่มของแต่ละหมวด (ไม่หายเมื่อหน้าวาดใหม่) */
const drafts = new Map<string, string>();
let focusGroup: string | null = null;
let addingGroup = false;

const items = (): PackItem[] => app.plan.packing ?? [];
const save = (next: PackItem[], toast?: string, undo?: () => void) => {
  app.commit((p) => (p.packing = next));
  if (toast) app.showToast(toast, undo);
};

export function initPacking(el: HTMLElement) {
  root = el;
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
}

export function renderPacking() {
  if (!root) return;
  // เปิดครั้งแรก: เริ่มจากรายการแนะนำของทริปนี้
  if (!app.plan.packing) {
    app.commit((p) => (p.packing = defaultPacking(() => uid('k'))));
    return; // commit จะเรียกวาดใหม่เอง
  }
  // หน้าวาดใหม่ระหว่างพิมพ์ (เช่น อากาศ/เส้นทางอัปเดต) → โฟกัสช่องเดิมต่อ
  const act = document.activeElement as HTMLElement | null;
  const typingIn = act && root.contains(act) ? (act.closest('form[data-pk-group]') as HTMLElement | null)?.dataset.pkGroup : undefined;
  if (focusGroup == null && typingIn != null) focusGroup = typingIn;
  const all = items();
  const done = all.filter((i) => i.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const groups = packGroups(all);
  root.innerHTML = `
  <div class="pk-wrap">
    <header class="pk-head">
      <h2>สิ่งของที่ต้องใช้</h2>
      <p class="pk-count"><b>${done}</b> / ${all.length} ชิ้น ${done === all.length && all.length ? '<span class="pk-ready">พร้อมแล้ว ✓</span>' : ''}</p>
      <div class="pk-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="เตรียมแล้ว ${pct}%"><i style="width:${pct}%"></i></div>
      <div class="pk-tools">
        <button class="pk-tool ${hideDone ? 'on' : ''}" data-pk="hide-done" aria-pressed="${hideDone}">${hideDone ? 'แสดงทั้งหมด' : 'ซ่อนที่เตรียมแล้ว'}</button>
        ${done ? '<button class="pk-tool" data-pk="reset">ล้างเครื่องหมาย (เช็กขากลับ)</button>' : ''}
      </div>
    </header>
    ${groups.map(groupHtml).join('')}
    ${
      addingGroup
        ? `<form class="pk-add pk-newgroup" data-pk-form="group"><input class="inp" name="group" maxlength="${PACK_LIMITS.group}" placeholder="ชื่อหมวดใหม่ เช่น ของฝาก" data-autofocus enterkeyhint="next" aria-label="ชื่อหมวดใหม่"><input class="inp" name="text" maxlength="${PACK_LIMITS.text}" placeholder="ของชิ้นแรก" enterkeyhint="done" aria-label="ของชิ้นแรก"><button class="btn sm primary">เพิ่มหมวด</button><button type="button" class="btn sm" data-pk="cancel-group">ยกเลิก</button></form>`
        : '<button class="pk-addgroup" data-pk="add-group">＋ เพิ่มหมวด</button>'
    }
    ${all.length ? '' : '<p class="empty">ยังไม่มีรายการ</p>'}
    <p class="muted small pk-foot">รายการนี้อยู่ในแผน — ส่งไปมือถือพร้อมแผนได้ · ติ๊กในเครื่องไหนก็ไม่หายเมื่อรับแผนใหม่ · <button class="link" data-pk="restore-defaults">เติมรายการแนะนำที่ลบไปกลับมา</button></p>
  </div>`;
  if (focusGroup != null) {
    const inp = root.querySelector(`form[data-pk-group="${CSS.escape(focusGroup)}"] input`) as HTMLInputElement | null;
    inp?.focus();
    focusGroup = null;
  } else (root.querySelector('[data-autofocus]') as HTMLInputElement | null)?.focus();
}

function groupHtml(g: { name: string; items: PackItem[] }): string {
  const done = g.items.filter((i) => i.done).length;
  const shown = hideDone ? g.items.filter((i) => !i.done) : g.items;
  const complete = done === g.items.length;
  return `<section class="pk-group ${complete ? 'complete' : ''}">
    <h3><span>${esc(g.name)}</span><span class="pk-gcount">${complete ? '✓ ครบ' : `${done}/${g.items.length}`}</span></h3>
    ${shown.length ? `<ul class="pk-list">${shown.map(itemHtml).join('')}</ul>` : hideDone ? '<p class="muted small pk-alldone">เตรียมครบหมวดนี้แล้ว</p>' : ''}
    <form class="pk-add" data-pk-form="item" data-pk-group="${esc(g.name)}">
      <input class="inp" name="text" maxlength="${PACK_LIMITS.text}" placeholder="＋ เพิ่มของใน${esc(g.name)}" value="${esc(drafts.get(g.name) ?? '')}" enterkeyhint="done" aria-label="เพิ่มของในหมวด ${esc(g.name)}">
      <button class="btn sm" aria-label="เพิ่ม">เพิ่ม</button>
    </form>
  </section>`;
}

function itemHtml(i: PackItem): string {
  return `<li class="pk-item ${i.done ? 'done' : ''}">
    <button class="pk-check" data-pk="toggle" data-id="${esc(i.id)}" role="checkbox" aria-checked="${i.done}"><span class="pk-box" aria-hidden="true">${i.done ? '✓' : ''}</span><span class="pk-text">${esc(i.text)}</span></button>
    <button class="pk-del" data-pk="del" data-id="${esc(i.id)}" aria-label="ลบ ${esc(i.text)}">×</button>
  </li>`;
}

function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-pk]') as HTMLElement | null;
  if (!el) return;
  const all = items();
  const id = el.dataset.id;
  switch (el.dataset.pk) {
    case 'toggle':
      save(all.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
      return;
    case 'del': {
      const it = all.find((i) => i.id === id);
      if (!it) return;
      const before = all;
      save(
        all.filter((i) => i.id !== id),
        `ลบ “${it.text}” แล้ว`,
        () => save(mergeBack(before, items(), it)),
      );
      return;
    }
    case 'hide-done':
      hideDone = !hideDone;
      break;
    case 'reset': {
      const before = all;
      save(
        all.map((i) => ({ ...i, done: false })),
        'ล้างเครื่องหมายแล้ว — ใช้เช็กของก่อนกลับได้',
        () => save(before),
      );
      return;
    }
    case 'add-group':
      addingGroup = true;
      break;
    case 'cancel-group':
      addingGroup = false;
      break;
    case 'restore-defaults': {
      const have = new Set(all.map((i) => `${i.group}|${i.text}`));
      const missing = defaultPacking(() => uid('k')).filter((i) => !have.has(`${i.group}|${i.text}`));
      if (!missing.length) {
        app.showToast('มีรายการแนะนำครบแล้ว');
        app.requestRender();
        return;
      }
      save([...all, ...missing], `เติมรายการแนะนำ ${missing.length} ชิ้น`, () => save(items().filter((i) => !missing.some((m) => m.id === i.id))));
      return;
    }
    default:
      return;
  }
  renderPacking();
}

/** เลิกทำการลบ: ใส่ของกลับตำแหน่งเดิม โดยไม่ทับการแก้อื่นที่เกิดหลังจากนั้น */
function mergeBack(before: PackItem[], now: PackItem[], it: PackItem): PackItem[] {
  if (now.some((i) => i.id === it.id)) return now;
  const idx = before.findIndex((i) => i.id === it.id);
  const after = before.slice(idx + 1).find((b) => now.some((n) => n.id === b.id));
  const at = after ? now.findIndex((n) => n.id === after.id) : now.length;
  return [...now.slice(0, at), it, ...now.slice(at)];
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const form = el.closest('form[data-pk-form="item"]') as HTMLFormElement | null;
  if (form) drafts.set(form.dataset.pkGroup!, el.value);
}

function onSubmit(e: Event) {
  const form = e.target as HTMLFormElement;
  if (!form.dataset.pkForm) return;
  e.preventDefault();
  const fd = new FormData(form);
  const text = String(fd.get('text') ?? '').trim().slice(0, PACK_LIMITS.text);
  const all = items();
  if (all.length >= PACK_LIMITS.items) {
    app.showToast(`มีได้สูงสุด ${PACK_LIMITS.items} ชิ้น`);
    app.requestRender();
    return;
  }
  if (form.dataset.pkForm === 'group') {
    const group = String(fd.get('group') ?? '').trim().slice(0, PACK_LIMITS.group);
    if (!group || !text) {
      app.showToast('ใส่ชื่อหมวดและของชิ้นแรก');
      app.requestRender();
      return;
    }
    addingGroup = false;
    focusGroup = group;
    save([...all, { id: uid('k'), text, group, done: false }]);
    return;
  }
  const group = form.dataset.pkGroup!;
  if (!text) return;
  drafts.delete(group);
  focusGroup = group; // พิมพ์ของชิ้นต่อไปได้ทันที
  // ใส่ต่อท้ายหมวดนั้น
  const lastIdx = all.map((i) => i.group).lastIndexOf(group);
  const next = [...all];
  next.splice(lastIdx + 1, 0, { id: uid('k'), text, group, done: false });
  save(next);
}
