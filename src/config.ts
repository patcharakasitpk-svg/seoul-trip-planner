/**
 * ช่วงวันเที่ยวตั้งต้นของแผนใหม่ (แก้ได้ตามทริป)
 * ใช้สร้างวันในแผนใหม่ และปุ่ม "ตั้งวันเที่ยวให้ครบ" สำหรับแผนเดิม
 */
/**
 * ซิงก์สดกับเพื่อน: URL ของ Firebase Realtime Database (ไม่ใช่ความลับ — สิทธิ์คุมด้วย Rules: เข้าได้เฉพาะคนที่มีรหัสห้อง)
 * ว่าง = ปิดฟีเจอร์ซิงก์ · ตั้งตอน build ด้วย VITE_SYNC_DB_URL ได้
 */
export const SYNC_DB_URL: string = ((import.meta as any).env?.VITE_SYNC_DB_URL as string | undefined) || '';

export const TRIP_DATES = { start: '2026-11-30', end: '2026-12-06' };

/** คืนที่ไม่ได้นอนโรงแรมหลัก: วันนั้นจบที่ hotelId และวันถัดไปเริ่มจาก hotelId */
/**
 * เที่ยวบิน TG656 ถึงอินชอน T1 จ. 30 พ.ย. 06:55 · TG653 ออกจาก T1 อา. 6 ธ.ค. 17:00
 * วันแรกออกจากสนามบินหลังผ่าน ตม./รับกระเป๋า (~08:00) · วันสุดท้ายถึงสนามบินก่อนเครื่องออก 3 ชม.
 */
export const TRIP_FLIGHTS = {
  arrive: { date: '2026-11-30', placeId: 'icn', time: '08:00', flight: 'TG656 06:55' },
  depart: { date: '2026-12-06', placeId: 'icn', arriveBy: '14:00', flight: 'TG653 17:00' },
};

export const TRIP_STAYS: { date: string; hotelId: string }[] = [{ date: '2026-12-05', hotelId: 'novotel-suwon' }];

/**
 * Firebase (บัญชีผู้ใช้ + ทริปที่แชร์) — ค่าเหล่านี้ไม่ใช่ความลับ (สิทธิ์คุมด้วย Security Rules)
 * ไม่ตั้ง = ไม่มีปุ่มเข้าสู่ระบบ แอปทำงานแบบเก็บในเครื่องเหมือนเดิม
 */
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
export const FIREBASE_CONFIG = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }
  : null;
/** ทดสอบในเครื่อง: http://127.0.0.1:9099 (Firebase Auth Emulator) */
export const FIREBASE_AUTH_EMULATOR = env.VITE_FIREBASE_AUTH_EMULATOR || '';
