/**
 * ช่วงวันเที่ยวตั้งต้นของแผนใหม่ (แก้ได้ตามทริป)
 * ใช้สร้างวันในแผนใหม่ และปุ่ม "ตั้งวันเที่ยวให้ครบ" สำหรับแผนเดิม
 */
export const TRIP_DATES = { start: '2026-11-30', end: '2026-12-06' };

/** คืนที่ไม่ได้นอนโรงแรมหลัก: วันนั้นจบที่ hotelId และวันถัดไปเริ่มจาก hotelId */
export const TRIP_STAYS: { date: string; hotelId: string }[] = [{ date: '2026-12-05', hotelId: 'novotel-suwon' }];
