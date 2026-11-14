/** สีประจำสายรถไฟฟ้า (ตามสีที่ใช้ในป้ายรถไฟใต้ดินโซล) */
export const LINES: Record<string, { label: string; color: string; th: string }> = {
  '1': { label: '1', color: '#0052A4', th: 'สาย 1 (น้ำเงินเข้ม)' },
  '2': { label: '2', color: '#00A84D', th: 'สาย 2 (เขียว)' },
  '3': { label: '3', color: '#EF7C1C', th: 'สาย 3 (ส้ม)' },
  '4': { label: '4', color: '#00A5DE', th: 'สาย 4 (ฟ้า)' },
  '5': { label: '5', color: '#996CAC', th: 'สาย 5 (ม่วง)' },
  '6': { label: '6', color: '#CD7C2F', th: 'สาย 6 (น้ำตาล)' },
  '7': { label: '7', color: '#747F00', th: 'สาย 7 (เขียวมะกอก)' },
  '8': { label: '8', color: '#E6186C', th: 'สาย 8 (ชมพู)' },
  '9': { label: '9', color: '#BDB092', th: 'สาย 9 (ทอง)' },
  SB: { label: 'ซินบุนดัง', color: '#D4003B', th: 'สายซินบุนดัง (แดง)' },
  SU: { label: 'ซูอิน-บุนดัง', color: '#F5A200', th: 'สายซูอิน-บุนดัง (เหลือง)' },
  GJ: { label: 'คย็องอึย-จุงอัง', color: '#77C4A3', th: 'สายคย็องอึย-จุงอัง (เขียวมิ้นต์)' },
  AREX: { label: 'AREX', color: '#0090D2', th: 'รถไฟสนามบิน AREX (ฟ้า)' },
  GC: { label: 'คย็องชุน', color: '#0C8E72', th: 'สายคย็องชุน' },
  UI: { label: 'อูอี', color: '#B7C452', th: 'สายอูอี-ซินซอล' },
  KORAIL: { label: 'รถไฟ', color: '#1B3F8C', th: 'รถไฟ Korail (ITX/มูกุงฮวา/KTX)' },
};
