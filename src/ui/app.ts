import type { Day, Place, Plan, Stop } from '../core/types';
import { computeSchedule, tripWindow, type DaySchedule, type ScheduleCtx } from '../core/schedule';
import { clone, newDay, newPlan, uid } from '../core/planOps';
import { PUBLIC_PLACES } from '../data/places';
import { loadPlans, loadSettings, savePlans, storageAvailable, type Settings, type StoredData } from '../storage/storage';
import { peekRoute, requestRoute, routeKey, setWanted, type RouteReq } from '../services/routes';
import { matchDayWeather, type DayWeather } from '../core/weather';
import { ensureWeather, getWeather } from '../services/weather';
import { fmtHM } from '../core/time';
import { liveEstimateMin, straightLineM } from '../core/geo';
import type { SearchResult } from '../services/placeSearch';
import { keepLocalCheckins } from '../storage/share';

export type Tab = 'today' | 'map' | 'places' | 'plan' | 'fx';

export type Modal =
  | { type: 'compare'; title: string; dayId: string; oldDay: Day; newDay: Day; note?: string; afterConfirm?: string }
  | { type: 'add'; placeId: string; dayId: string; index: number | null }
  | { type: 'templates'; tplId: string; /** การ์ดที่ i → วันปลายทางที่เลือกไว้ */ targets?: Record<number, string> }
  | { type: 'share' }
  | { type: 'import'; plan: Plan; warnings: string[]; source: 'link' | 'json' }
  | { type: 'confirm'; message: string; okLabel: string; action: () => void }
  | { type: 'dinner'; dayId: string; stopUid: string; zone: string | null }
  | { type: 'nearby'; dayId: string; stopUid: string; want: 'shop' | 'eat' }
  | { type: 'route'; fromId: string; toId: string; date: string | null; departMins: number | null; dayId: string; stopUid: string | null }
  | { type: 'reorder'; dayId: string }
  | { type: 'custom' }
  | { type: 'leg'; dayId: string; target: string }
  | { type: 'stop'; dayId: string; stopUid: string }
  | { type: 'meal'; dayId: string }
  | { type: 'settings' }
  | { type: 'place'; placeId: string }
  | { type: 'indoor'; dayId: string };

export interface Filters {
  q: string;
  cat: string; // '' | category | 'saved'
  area: string;
  budget: string; // '' | 'low' | 'mid' | 'high'
  stay: string; // '' | 'short' | 'mid' | 'long'
  fashion: string;
  zone: string;
}

/** ผลค้นหาสถานที่จาก Google / OpenStreetMap (ชั่วคราว ไม่บันทึกลงแผน) */
export interface WebSearch {
  q: string;
  status: 'loading' | 'done' | 'error';
  provider?: 'google' | 'osm';
  results: SearchResult[];
  note?: string;
  focus: number | null;
}

export const SEOUL_CENTER = { lat: 37.5663, lng: 126.9779, name: 'กลางกรุงโซล (ศาลากลาง)' };

class AppState {
  store: StoredData;
  activeDayId: string;
  tab: Tab = 'plan';
  filters: Filters = { q: '', cat: '', area: '', budget: '', stay: '', fashion: '', zone: '' };
  mapFilter: 'all' | 'day' = 'all';
  showLibPins = false;
  modal: Modal | null = null;
  toast: { msg: string; at: number; undo?: () => void } | null = null;
  saveOk = true;
  storageOk = storageAvailable();
  settings: Settings = loadSettings();
  online = typeof navigator === 'undefined' ? true : navigator.onLine;
  refPoint = 'hotel';
  expanded = new Set<string>();
  focusPlaceId: string | null = null;
  fitNext = true;
  search: WebSearch | null = null;
  /** วันที่เลือกดูในหน้า "วันนี้" (null = วันตามปฏิทินจริง) */
  todayDayId: string | null = null;
  /** ครั้งถัดไปให้แผนที่ซูมพอดีผลค้นหา */
  fitSearch = false;

  private needs = new Map<string, RouteReq>();
  private placeCache: { custom: Place[]; over: Plan['coordOverrides']; map: Map<string, Place>; list: Place[] } | null = null;
  renderFn: () => void = () => {};
  private renderQueued = false;
  private routeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const loaded = loadPlans();
    if (loaded) this.store = loaded;
    else {
      const p = newPlan();
      this.store = { activeId: p.id, plans: [p] };
    }
    this.activeDayId = this.plan.days[0].id;
  }

  get plan(): Plan {
    return this.store.plans.find((p) => p.id === this.store.activeId) ?? this.store.plans[0];
  }

  get day(): Day {
    return this.plan.days.find((d) => d.id === this.activeDayId) ?? this.plan.days[0];
  }

  dayIndex(id: string) {
    return this.plan.days.findIndex((d) => d.id === id);
  }

  findDay(id: string): Day | undefined {
    return this.plan.days.find((d) => d.id === id);
  }

  places(): Place[] {
    this.ensurePlaces();
    return this.placeCache!.list;
  }

  getPlace = (id: string | null | undefined): Place | undefined => {
    if (!id) return undefined;
    this.ensurePlaces();
    return this.placeCache!.map.get(id);
  };

  private ensurePlaces() {
    const custom = this.plan.customPlaces;
    const over = this.plan.coordOverrides;
    if (!this.placeCache || this.placeCache.custom !== custom || this.placeCache.over !== over) {
      // พิกัดที่ผู้ใช้ตั้งเอง (สำหรับร้านที่ยังไม่มีพิกัด) — ปักหมุดได้ทุกหน้า
      const withOver = (p: Place): Place => (over?.[p.id] ? { ...p, lat: over[p.id].lat, lng: over[p.id].lng, coordStatus: 'user' } : p);
      const list = [...PUBLIC_PLACES, ...custom].map(withOver);
      this.placeCache = { custom, over, list, map: new Map(list.map((p) => [p.id, p])) };
    }
  }

  stayFor(placeId: string): number {
    const o = this.plan.stayOverrides[placeId];
    if (o != null) return o;
    const p = this.getPlace(placeId);
    return p?.food?.mealMin ?? p?.suggestedStayMin ?? 60;
  }

  /** ctx สำหรับคำนวณตาราง — เก็บรายการเส้นทางที่ยังไม่มีเพื่อขอภายหลัง */
  /** เวลาเดินทางโดยประมาณจากระยะเส้นตรง (ใช้เมื่อไม่มีข้อมูลจากบริการ/ผู้ใช้) */
  estimateMin = (fromId: string, toId: string, mode: Stop['legIn']['mode']): number | null => {
    const a = this.getPlace(fromId);
    const b = this.getPlace(toId);
    if (a?.lat == null || a.lng == null || b?.lat == null || b.lng == null) return null;
    return liveEstimateMin(straightLineM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }), mode);
  };

  ctxFor(day: Day): ScheduleCtx {
    return {
      getPlace: this.getPlace,
      estimate: this.estimateMin,
      getRoute: (fromId, toId, mode, date, dep) => {
        const key = routeKey(fromId, toId, mode, date, dep, day.prefs);
        const r = peekRoute(key, fromId, toId, mode);
        if (!r && date) {
          const a = this.getPlace(fromId);
          const b = this.getPlace(toId);
          if (a?.lat != null && a.lng != null && b?.lat != null && b.lng != null) {
            this.needs.set(key, { from: { id: fromId, lat: a.lat, lng: a.lng }, to: { id: toId, lat: b.lat, lng: b.lng }, mode, date, departMins: dep, prefs: day.prefs });
          } else {
            return { status: 'no-coords', message: '' };
          }
        }
        return r;
      },
    };
  }

  schedule(day: Day): DaySchedule {
    return computeSchedule(day, this.ctxFor(day));
  }

  /** ตารางแบบเดินทางจริง: ใช้เวลาที่เช็กอิน + เวลาประมาณจากระยะเมื่อไม่มีข้อมูล · now = null เมื่อดูวันอื่น */
  liveSchedule(day: Day, now: number | null): DaySchedule {
    return computeSchedule(day, { ...this.ctxFor(day), live: { now, estimate: this.estimateMin } });
  }


  /** ขอข้อมูลเส้นทางสำหรับช่วงที่ยังไม่มี (เรียกหลัง render, หน่วงเวลาเพื่อลดคำขอเมื่อแก้เร็ว ๆ) */
  flushRouteNeeds() {
    const needs = new Map(this.needs);
    this.needs.clear();
    if (this.routeTimer) clearTimeout(this.routeTimer);
    this.routeTimer = setTimeout(() => {
      setWanted(new Set(needs.keys()));
      for (const req of needs.values()) requestRoute(req);
    }, 450);
  }

  requestExtraRoute(fromId: string, toId: string, mode: Stop['legIn']['mode'], date: string | null, dep: number | null, day: Day) {
    this.ctxFor(day).getRoute(fromId, toId, mode, date, dep);
  }

  weatherRefPoint(day: Day): { lat: number; lng: number; name: string } {
    if (day.weatherRef && day.weatherRef !== 'seoul') {
      const p = this.getPlace(day.weatherRef);
      if (p?.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng, name: p.nameTh };
    }
    return SEOUL_CENTER;
  }

  dayWeather(day: Day, sched?: DaySchedule): { w: DayWeather | null; ref: { lat: number; lng: number; name: string }; state: ReturnType<typeof getWeather>; windowLabel: string } {
    const ref = this.weatherRefPoint(day);
    const s = sched ?? this.schedule(day);
    const win = tripWindow(day, s);
    if (day.date) ensureWeather(ref.lat, ref.lng);
    const state = getWeather(ref.lat, ref.lng);
    const data = state && (state.status === 'ok' ? state.data : state.status === 'error' ? state.data : undefined);
    const w = matchDayWeather(data ?? null, day.date, win);
    return { w, ref, state, windowLabel: win ? `${fmtHM(win.from)}–${fmtHM(win.to)}` : 'ทั้งวัน (ยังไม่กำหนดเวลา)' };
  }

  commit(mutator: (plan: Plan) => void, toast?: string) {
    const p = clone(this.plan);
    mutator(p);
    p.updatedAt = new Date().toISOString();
    this.store.plans = this.store.plans.map((x) => (x.id === p.id ? p : x));
    if (!p.days.some((d) => d.id === this.activeDayId)) this.activeDayId = p.days[0].id;
    this.persist();
    if (toast) this.showToast(toast);
    this.requestRender();
  }

  setDay(dayId: string, newDayValue: Day, toast?: string) {
    this.commit((p) => {
      p.days = p.days.map((d) => (d.id === dayId ? clone(newDayValue) : d));
    }, toast);
  }

  updateDay(dayId: string, fn: (d: Day) => Day | void, toast?: string) {
    this.commit((p) => {
      p.days = p.days.map((d) => {
        if (d.id !== dayId) return d;
        const r = fn(d);
        return r ?? d;
      });
    }, toast);
  }

  /** เรียกหลังบันทึกทุกครั้ง (ใช้ส่งแผนขึ้นห้องซิงก์) */
  onPersist: () => void = () => {};

  persist() {
    this.saveOk = savePlans(this.store);
    this.onPersist();
  }

  addPlan(plan: Plan, activate = true) {
    this.store.plans.push(plan);
    if (activate) {
      this.store.activeId = plan.id;
      this.activeDayId = plan.days[0].id;
    }
    this.persist();
    this.fitNext = true;
    this.requestRender();
  }

  /** ใช้แผนที่ได้รับจากเครื่องอื่น: แผนเดียวกัน (id ตรง) → แทนที่ฉบับนั้น · ไม่งั้นแทนที่แผนที่เปิดอยู่ · เก็บเช็กอินในเครื่องไว้ */
  receivePlan(incoming: Plan): () => void {
    const target = this.store.plans.find((x) => x.id === incoming.id) ?? this.plan;
    const before = { plans: this.store.plans.map((x) => x), activeId: this.store.activeId, dayId: this.activeDayId };
    // ใช้ id ของแผนที่ส่งมา → ส่งครั้งต่อไปจะรู้ว่าเป็นแผนเดียวกัน
    const next = keepLocalCheckins({ ...incoming, roomId: target.roomId ?? null }, target);
    this.store.plans = this.store.plans.map((x) => (x.id === target.id ? next : x));
    this.store.activeId = next.id;
    this.activeDayId = next.days[0].id;
    this.todayDayId = null;
    this.persist();
    this.fitNext = true;
    this.requestRender();
    return () => {
      this.store.plans = before.plans;
      this.store.activeId = before.activeId;
      this.activeDayId = before.dayId;
      this.persist();
      this.requestRender();
    };
  }

  replaceActivePlan(plan: Plan) {
    plan.id = this.plan.id;
    this.store.plans = this.store.plans.map((x) => (x.id === plan.id ? plan : x));
    this.activeDayId = plan.days[0].id;
    this.persist();
    this.fitNext = true;
    this.requestRender();
  }

  newEmptyPlan() {
    const p = newPlan(`แผนใหม่ ${this.store.plans.length + 1}`);
    p.days = [newDay()];
    this.addPlan(p);
  }

  showToast(msg: string, undo?: () => void) {
    this.toast = { msg, at: Date.now(), undo };
    const at = this.toast.at;
    setTimeout(() => {
      if (this.toast?.at === at) {
        this.toast = null;
        this.requestRender();
      }
    }, undo ? 5000 : 3200);
  }

  /** ระหว่างนิ้ว/เมาส์กดค้าง ห้าม render (ไม่งั้นปุ่มที่กำลังกดถูกแทนที่ และการคลิกหาย) */
  pointerDown = false;
  private renderWaiting = false;

  requestRender() {
    if (this.pointerDown) {
      this.renderWaiting = true;
      return;
    }
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.renderFn();
    });
  }

  releasePointer() {
    this.pointerDown = false;
    if (this.renderWaiting) {
      this.renderWaiting = false;
      this.requestRender();
    }
  }

  newUid = uid;
}

export const app = new AppState();
export type App = AppState;
