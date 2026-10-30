/**
 * ภาษาของหน้าจอคนงาน (บทบาท WORKER) — พม่า / ไทย / อังกฤษ · เริ่มต้นพม่า สลับได้ที่มุมขวาบน (คุกกี้ต่อเครื่อง)
 * ใช้เฉพาะหน้าที่คนงานเห็น (หน้าแรก เมนู ลงเวลา เข้าออกของฉัน) — ผู้ใช้อื่นเป็นภาษาไทยเหมือนเดิมเสมอ
 *
 * ⚠ คำแปลพม่าควรให้คนที่อ่านพม่าออกตรวจก่อนใช้จริง — แก้ที่ตารางนี้ที่เดียว
 * ไฟล์นี้ไม่มี I/O ใช้ได้ทั้งเซิร์ฟเวอร์และหน้าจอ
 */
export type WorkerLang = "my" | "th" | "en";
/** ลำดับบนปุ่มสลับ */
export const WORKER_LANGS: { code: WorkerLang; label: string }[] = [
  { code: "my", label: "မြန်မာ" },
  { code: "th", label: "ไทย" },
  { code: "en", label: "English" },
];
export const WORKER_LANG_COOKIE = "sb_worker_lang";
export const DEFAULT_WORKER_LANG: WorkerLang = "my";

export function parseWorkerLang(value: string | undefined | null): WorkerLang {
  return value === "th" || value === "en" || value === "my" ? value : DEFAULT_WORKER_LANG;
}

const DICT = {
  // หน้าแรก / เมนู
  hello: { th: "สวัสดี", en: "Hello", my: "မင်္ဂလာပါ" },
  moduleDailyWorker: { th: "คนงานรายวัน", en: "Daily workers", my: "နေ့စားအလုပ်သမား" },
  moduleChatReport: { th: "แชท & รีพอต", en: "Chat & Report", my: "ချတ် & အစီရင်ခံစာ" },
  menuClock: { th: "ลงเวลา", en: "Clock in", my: "အချိန်မှတ်" },
  menuMyWeek: { th: "เข้าออกของฉัน", en: "My attendance", my: "ကျွန်ုပ်၏ အဝင်အထွက်" },
  menuChat: { th: "แชท", en: "Chat", my: "ချတ်" },
  menuReport: { th: "รายงาน", en: "Reports", my: "အစီရင်ခံစာ" },
  langLabel: { th: "ภาษา", en: "Language", my: "ဘာသာ" },

  // ลงเวลา
  clockIn: { th: "เข้างาน", en: "Clock in", my: "အလုပ်ဝင်" },
  clockOut: { th: "ออกงาน", en: "Clock out", my: "အလုပ်ထွက်" },
  breakStart: { th: "เริ่มพัก", en: "Start break", my: "နားချိန်စ" },
  breakEnd: { th: "กลับจากพัก", en: "End break", my: "နားချိန်ပြီး" },
  clockAuto: { th: "ลงเวลา", en: "Clock", my: "အချိန်မှတ်" },
  timeNow: { th: "เวลาตอนนี้", en: "Time now", my: "ယခုအချိန်" },
  shift: { th: "กะ", en: "Shift", my: "အလုပ်ချိန်" },
  restDayToday: { th: "วันนี้เป็นวันหยุดตามกะ", en: "Today is your day off", my: "ယနေ့ ပိတ်ရက်ဖြစ်သည်" },
  beforeEnd: { th: "ยังไม่ถึงเวลาเลิกงาน ({time}) · อีก {left}", en: "Not end of shift yet ({time}) · {left} left", my: "အလုပ်ဆင်းချိန် ({time}) မရောက်သေးပါ · နောက် {left}" },
  afterEnd: { th: "ถึงเวลาเลิกงานแล้ว ({time}) · ออกงานได้", en: "Shift ended ({time}) · you can clock out", my: "အလုပ်ဆင်းချိန် ({time}) ရောက်ပြီ · ထွက်နိုင်ပါပြီ" },
  beforeStart: { th: "เข้างาน {time} · อีก {left}", en: "Start {time} · in {left}", my: "အလုပ်ဝင်ချိန် {time} · နောက် {left}" },
  afterStart: { th: "เลยเวลาเข้างาน ({time}) มา {late}", en: "Past start time ({time}) by {late}", my: "အလုပ်ဝင်ချိန် ({time}) ကျော်ပြီ · {late}" },
  hours: { th: "ชม.", en: "h", my: "နာရီ" },
  minutes: { th: "นาที", en: "min", my: "မိနစ်" },
  yesterday: { th: "เมื่อวาน", en: "Yesterday", my: "မနေ့က" },
  lateMin: { th: "สาย {n} นาที", en: "{n} min late", my: "{n} မိနစ် နောက်ကျ" },
  cannotClock: { th: "ยังลงเวลาไม่ได้", en: "Cannot clock in yet", my: "အချိန်မှတ်၍ မရသေးပါ" },
  locating: { th: "กำลังหาตำแหน่ง…", en: "Finding location…", my: "တည်နေရာ ရှာနေသည်…" },
  saving: { th: "กำลังบันทึก…", en: "Saving…", my: "သိမ်းနေသည်…" },
  tapAgain: { th: "กดอีก 1 ครั้ง", en: "Tap once more", my: "နောက်တစ်ကြိမ် နှိပ်ပါ" },
  toConfirm: { th: "เพื่อยืนยัน{what}", en: "to confirm {what}", my: "{what} အတည်ပြုရန်" },
  tapTwice: { th: "กด 2 ครั้ง เพื่อ{what}", en: "Tap 2 times to {what}", my: "{what} အတွက် ၂ ကြိမ် နှိပ်ပါ" },
  takePhotoFor: { th: "ถ่ายรูปเพื่อ{what}", en: "Take photo to {what}", my: "{what} အတွက် ဓာတ်ပုံရိုက်ပါ" },
  cancel: { th: "ยกเลิก", en: "Cancel", my: "မလုပ်တော့ပါ" },
  todayLog: { th: "การลงเวลาวันนี้", en: "Today's records", my: "ယနေ့ အချိန်မှတ်တမ်း" },
  noLogYet: { th: "ยังไม่มีการลงเวลา", en: "No records yet", my: "အချိန်မှတ်တမ်း မရှိသေးပါ" },
  saved: { th: "บันทึก{what}เรียบร้อย", en: "{what} saved", my: "{what} မှတ်ပြီးပါပြီ" },
  pendingReview: { th: "บันทึกแล้ว รอฝ่ายบุคคลตรวจสอบ", en: "Saved · waiting for HR review", my: "မှတ်ပြီးပါပြီ · HR စစ်ဆေးရန် စောင့်ပါ" },
  rejected: { th: "ลงเวลาไม่ผ่าน", en: "Not accepted", my: "အချိန်မှတ်ခြင်း မအောင်မြင်ပါ" },
  justClockedIn: { th: "บันทึกเข้างานแล้ว ไม่ต้องกดซ้ำ", en: "Clock-in already saved — no need to tap again", my: "အလုပ်ဝင်ချိန် မှတ်ပြီးပါပြီ · ထပ်နှိပ်ရန် မလိုပါ" },
  clockFailed: { th: "ลงเวลาไม่สำเร็จ", en: "Could not clock in", my: "အချိန်မှတ်ခြင်း မအောင်မြင်ပါ" },
  sendFailed: { th: "ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง", en: "Could not send, try again", my: "ပို့၍ မရပါ · ထပ်ကြိုးစားပါ" },
  noInternet: { th: "เชื่อมต่อไม่ได้ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่", en: "No connection, check internet and try again", my: "အင်တာနက် ချိတ်ဆက်မရပါ · ထပ်ကြိုးစားပါ" },
  loadFailed: { th: "โหลดข้อมูลไม่สำเร็จ", en: "Could not load", my: "ဒေတာ ဖွင့်၍ မရပါ" },
  photoFailed: { th: "อ่านรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง", en: "Could not read photo, take it again", my: "ဓာတ်ပုံ ဖတ်၍ မရပါ · ပြန်ရိုက်ပါ" },
  photoRequired: { th: "บริษัทกำหนดให้ถ่ายรูปตอนลงเวลา — กดปุ่ม \"ถ่ายรูป\" ด้านบน", en: "A photo is required — tap \"Take photo\" above", my: "အချိန်မှတ်ရင် ဓာတ်ပုံ လိုအပ်သည် · အပေါ်က ဓာတ်ပုံ ခလုတ်ကို နှိပ်ပါ" },
  distance: { th: " (ห่างจากจุดที่ตั้งไว้ {m} ม.)", en: " ({m} m from the site)", my: " (သတ်မှတ်နေရာမှ {m} မီတာ ဝေးသည်)" },
  locationOff: { th: "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งในการตั้งค่าเครื่อง แล้วลองใหม่", en: "Location not allowed — turn on Location in phone settings and try again", my: "တည်နေရာ ခွင့်မပြုရသေးပါ · ဖုန်း Setting တွင် Location ဖွင့်ပြီး ထပ်ကြိုးစားပါ" },
  mapLoading: { th: "กำลังโหลดแผนที่…", en: "Loading map…", my: "မြေပုံ ဖွင့်နေသည်…" },
  inRange: { th: "อยู่ในระยะของ {site} — กดลงเวลาได้", en: "Inside {site} — you can clock in", my: "{site} နယ်မြေအတွင်း ရှိသည် · အချိန်မှတ်နိုင်ပါပြီ" },
  outOfRange: { th: "ห่างจาก {site} {dist} (รัศมี {radius})", en: "{dist} from {site} (radius {radius})", my: "{site} မှ {dist} ဝေးသည် (အကွာအဝေး {radius})" },
  meters: { th: "{n} ม.", en: "{n} m", my: "{n} မီတာ" },
  km: { th: "{n} กม.", en: "{n} km", my: "{n} ကီလိုမီတာ" },
  noGeo: { th: "เครื่องนี้ไม่รองรับการระบุตำแหน่ง", en: "This phone has no location", my: "ဤဖုန်းသည် တည်နေရာ မထောက်ပံ့ပါ" },
  geoFailed: { th: "หาตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง", en: "Could not find location, try again", my: "တည်နေရာ ရှာ၍ မရပါ · ထပ်ကြိုးစားပါ" },
  refreshLocation: { th: "รีเฟรชตำแหน่ง", en: "Refresh location", my: "တည်နေရာ ပြန်ရှာ" },
  issueButton: { th: "ลงเวลาไม่ได้ · แจ้งไอที", en: "Can't clock in · Tell IT", my: "အချိန်မှတ်၍ မရပါ · IT ကို အကြောင်းကြားရန်" },
  issueSending: { th: "กำลังส่ง…", en: "Sending…", my: "ပို့နေသည်…" },
  issueSent: { th: "ไอทีจะตอบกลับทางแจ้งเตือน", en: "IT will reply in notifications", my: "IT က အကြောင်းကြားချက်ဖြင့် ပြန်ဖြေပါမည်" },
  issueFailed: { th: "ส่งเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง", en: "Could not send, try again", my: "ပို့၍ မရပါ · ထပ်ကြိုးစားပါ" },

  // เข้าออกของฉัน
  thisWeek: { th: "สัปดาห์นี้", en: "This week", my: "ဒီအပတ်" },
  today: { th: "วันนี้", en: "Today", my: "ယနေ့" },
  in: { th: "เข้า", en: "In", my: "ဝင်" },
  out: { th: "ออก", en: "Out", my: "ထွက်" },
  present: { th: "มา", en: "Present", my: "လာ" },
  absent: { th: "ขาด", en: "Absent", my: "ပျက်ကွက်" },
  noShow: { th: "ไม่มา", en: "No-show", my: "မလာ" },
  dayOff: { th: "หยุด", en: "Day off", my: "ပိတ်ရက်" },
  leave: { th: "ลา", en: "Leave", my: "ခွင့်" },
  restDay: { th: "หยุดตามกะ", en: "Rest day", my: "ပိတ်ရက်" },
  fixed: { th: "มา (แก้แล้ว)", en: "Present (fixed)", my: "လာ (ပြင်ပြီး)" },
  earlyOut: { th: "กลับก่อนเวลา", en: "Left early", my: "စောပြန်" },
  noShiftYet: { th: "ยังไม่ได้ผูกกะ — แจ้งผู้ดูแล", en: "No shift yet — tell your supervisor", my: "အလုပ်ချိန် မသတ်မှတ်ရသေးပါ · တာဝန်ခံကို ပြောပါ" },
  weekFootnote: {
    th: "เข้าหลังเวลาเข้ากะ = สาย หักเงินตามนาที · ไม่ลงเวลาออก = ขาด · ไปหน้างานแล้วลงเวลาไม่ทัน แจ้งผู้ดูแลให้แก้เวลา · วันหยุดผู้ดูแลเป็นคนลง",
    en: "In after shift start = late, pay cut by the minute · No clock-out = absent · Couldn't clock in from a job site? Ask your supervisor to fix the time · Days off are set by your supervisor",
    my: "အလုပ်ဝင်ချိန်ထက် နောက်ကျရင် နောက်ကျဟု မှတ်ပြီး မိနစ်အလိုက် လုပ်ခ ဖြတ်သည် · အထွက်အချိန် မမှတ်ရင် ပျက်ကွက်ဟု မှတ်သည် · လုပ်ငန်းခွင်မှ အချိန်မမှတ်နိုင်ရင် တာဝန်ခံကို ပြင်ခိုင်းပါ · ပိတ်ရက်ကို တာဝန်ခံက သတ်မှတ်ပေးသည်",
  },
  // ช่องเขียนรีพอต (report-composer / report-post-fields) — ข้อความไทยต้องตรงกับของเดิมทุกตัว
  writeReport: { th: "เขียนรายงานหรือข้อความ...", en: "Write a report or message...", my: "အစီရင်ခံစာ သို့မဟုတ် စာ ရေးပါ..." },
  reportTitle: { th: "หัวข้อรีพอต", en: "Report title", my: "ခေါင်းစဉ်" },
  reportTitlePh: { th: "หัวข้อรีพอต เช่น สรุปอัปเดตประจำสัปดาห์", en: "Report title, e.g. Today's work", my: "ခေါင်းစဉ် ဥပမာ - ဒီနေ့ လုပ်ခဲ့သည့်အလုပ်" },
  reportBodyPh: {
    th: "พิมพ์แต่ละบรรทัด = แต่ละบูลเล็ต, ลากห้องจากแถบด้านซ้ายมาวางเพื่อแท็กได้เลย",
    en: "Type here — one line per point",
    my: "ဒီမှာ ရေးပါ · တစ်ကြောင်းလျှင် တစ်ချက်",
  },
  attachFile: { th: "แนบไฟล์", en: "Attach file", my: "ဖိုင်/ဓာတ်ပုံ ထည့်" },
  attaching: { th: "กำลังแนบไฟล์...", en: "Attaching...", my: "ထည့်နေသည်..." },
  addTag: { th: "ติดแท็ก", en: "Add tag", my: "Tag ထည့်" },
  expand: { th: "ขยาย", en: "Expand", my: "ချဲ့" },
  collapse: { th: "ย่อ", en: "Collapse", my: "ချုံ့" },
  enterHint: { th: "Enter โพสต์ · Shift+Enter ขึ้นบรรทัดใหม่", en: "Enter to post · Shift+Enter new line", my: "Enter = ပို့ · Shift+Enter = စာကြောင်းအသစ်" },
  needTitle: { th: "ต้องมีหัวข้อ", en: "Title required", my: "ခေါင်းစဉ် လိုအပ်သည်" },
  needPhotos: { th: "ต้องแนบรูปอีก {n} รูป", en: "Add {n} more photo(s)", my: "ဓာတ်ပုံ နောက်ထပ် {n} ပုံ ထည့်ပါ" },
  post: { th: "โพสต์", en: "Post", my: "ပို့မည်" },
  currentRound: { th: "ตอนนี้อยู่ในรอบ", en: "Current round", my: "ယခု အချိန်ပိုင်း" },
  minPhotos: { th: "ต้องแนบรูปอย่างน้อย {n} รูป", en: "at least {n} photo(s)", my: "ဓာတ်ပုံ အနည်းဆုံး {n} ပုံ" },
  whichRound: { th: "ส่งของรอบไหน?", en: "Which round?", my: "ဘယ်အချိန်ပိုင်းအတွက်လဲ?" },
  late: { th: "สาย", en: "late", my: "နောက်ကျ" },
  notTodayReport: { th: "โพสต์นี้ไม่ใช่รีพอตของวันนี้ (เช่น ถาม/แจ้งอัปเดตเฉยๆ)", en: "This is not today's report (just a question/update)", my: "ဒါ ဒီနေ့ အစီရင်ခံစာ မဟုတ်ပါ (မေးခွန်း/သတင်း သက်သက်)" },
  lateRoundWarn: { th: "โพสต์นี้จะนับเป็นส่งสายของ \"{round}\" — เลยเวลา {time} แล้ว", en: "This counts as late for \"{round}\" — past {time}", my: "\"{round}\" အတွက် နောက်ကျ ပို့သည်ဟု မှတ်မည် · {time} ကျော်ပြီ" },
  closedToday: { th: "ปิดรับรายงานของวันนี้แล้ว (หลัง {time} น.) — ส่งได้อีกทีพรุ่งนี้", en: "Reports closed for today (after {time}) — send again tomorrow", my: "ယနေ့ အစီရင်ခံစာ ပိတ်ပြီ ({time} နောက်ပိုင်း) · မနက်ဖြန် ပို့ပါ" },
  prevWeek: { th: "สัปดาห์ก่อน", en: "Previous week", my: "ယခင်အပတ်" },
  nextWeek: { th: "สัปดาห์ถัดไป", en: "Next week", my: "နောက်အပတ်" },
  monthSummary: { th: "ทั้งเดือน {month}", en: "Whole month · {month}", my: "တစ်လလုံး · {month}" },
  days: { th: "{n} วัน", en: "{n} d", my: "{n} ရက်" },
} as const;

export type WorkerTextKey = keyof typeof DICT;

export function tr(lang: WorkerLang, key: WorkerTextKey, vars?: Record<string, string | number>): string {
  let s: string = DICT[key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** วันในสัปดาห์ จ.–อา. (index 0 = จันทร์) */
export const WEEKDAYS_MON: Record<WorkerLang, string[]> = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  my: ["တနင်္လာ", "အင်္ဂါ", "ဗုဒ္ဓဟူး", "ကြာသပတေး", "သောကြာ", "စနေ", "တနင်္ဂနွေ"],
};
export const MONTHS_SHORT: Record<WorkerLang, string[]> = {
  th: ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  my: ["ဇန်", "ဖေ", "မတ်", "ဧ", "မေ", "ဇွန်", "ဇူ", "ဩ", "စက်", "အောက်", "နို", "ဒီ"],
};
/** ปีที่แสดง — ไทยใช้ พ.ศ. · พม่าใช้ ค.ศ. */
export function displayYear(lang: WorkerLang, year: number): number {
  return lang === "th" ? year + 543 : year;
}

/** แปลชื่อเมนู/โมดูลของคนงานตามเส้นทาง (lib/nav.ts) */
export const WORKER_MENU_KEYS: Record<string, WorkerTextKey> = {
  "/daily-workers/clock": "menuClock",
  "/daily-workers/me": "menuMyWeek",
};
export const WORKER_MODULE_KEYS: Record<string, WorkerTextKey> = {
  daily_worker: "moduleDailyWorker",
  chat_report: "moduleChatReport",
};
