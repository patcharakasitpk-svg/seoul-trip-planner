import { describe, it, expect } from 'vitest';
import { authErrorText, inAppBrowser } from '../../src/services/auth';
describe('เข้าสู่ระบบ: ข้อความภาษาไทย', () => {
  it('ปิดหน้าต่าง Google เอง = ไม่ต้องแจ้ง · โควตาอีเมลหมด = แนะนำ Google · ลิงก์หมดอายุ = ขอใหม่', () => {
    expect(authErrorText('auth/popup-closed-by-user')).toBe('');
    expect(authErrorText('auth/quota-exceeded')).toContain('Google');
    expect(authErrorText('auth/invalid-action-code')).toContain('ขอลิงก์ใหม่');
    expect(authErrorText('auth/something-else')).toContain('auth/something-else');
  });
  it('รู้ว่ากำลังเปิดในแอป LINE/IG', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Line/14.0.0')).toBe('LINE');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Instagram 300')).toBe('Instagram');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1.15')).toBeNull();
  });
});
