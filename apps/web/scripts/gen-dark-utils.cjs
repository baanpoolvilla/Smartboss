// สร้าง app/theme-dark-utils.css — แปลงคลาสสีชุด Tailwind ที่ใส่ตายตัว (bg-amber-50, text-red-700 …) ให้อ่านได้ในธีมมืด
// รัน: node scripts/gen-dark-utils.cjs  (ไฟล์ที่ได้ commit ไว้ — แก้กติกาที่นี่แล้วรันใหม่)
// หลัก: พื้นอ่อน (50–200) → พื้นเข้มอมสีของการ์ด · ตัวหนังสือเข้ม (600–950) → เฉดสว่าง · เส้นขอบอ่อน → เส้นอมสีบนพื้นเข้ม
// ปุ่มสีกลาง (400–600 พื้น + ตัวขาว) และพื้นเข้ม (700–950) ไม่แตะ — อ่านได้ทั้งสองธีมอยู่แล้ว
const fs = require("fs");
const path = require("path");

const hues = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const neutrals = ["slate", "gray", "zinc", "neutral", "stone"];
const D = '[data-theme="dark"]';
// เอกสารที่พิมพ์ได้ (สลิป ใบหักภาษี รายงานเซ็นรับเงิน) ติด data-paper — คงเป็นกระดาษขาวในธีมมืด ไม่แปลงสีข้างใน
const NP = ":not([data-paper] *)";
// ทุกอักขระที่ไม่ใช่ตัวอักษร/ตัวเลข/-/_ ต้อง escape ในชื่อคลาส (: / . [ ] # ( ) % ,)
const cls = (c) => "." + c.replace(/[^a-zA-Z0-9_-]/g, (m) => "\\" + m);
const out = [];
const rule = (classes, decl) => out.push(`${classes.map((c) => `${D} ${cls(c)}${c.startsWith("hover:") ? ":hover" : ""}${NP}`).join(",\n")} { ${decl} }`);

for (const h of hues) {
  const mix = (p) => `color-mix(in oklab, var(--color-${h}-500) ${p}%, var(--bg))`;
  rule([`bg-${h}-50`, `hover:bg-${h}-50`], `background-color: ${mix(12)};`);
  rule([`bg-${h}-100`, `hover:bg-${h}-100`], `background-color: ${mix(20)};`);
  rule([`bg-${h}-200`, `hover:bg-${h}-200`], `background-color: ${mix(30)};`);
  for (const a of [30, 40, 50, 60, 70, 80]) rule([`bg-${h}-50/${a}`], `background-color: color-mix(in oklab, var(--color-${h}-500) ${Math.round((12 * a) / 100) + 4}%, transparent);`);
  rule([`text-${h}-500`], `color: var(--color-${h}-400);`);
  rule([`text-${h}-600`, `text-${h}-700`, `hover:text-${h}-700`], `color: var(--color-${h}-300);`);
  rule([`text-${h}-800`, `text-${h}-900`, `text-${h}-950`], `color: var(--color-${h}-200);`);
  rule([`border-${h}-100`, `border-${h}-200`, `border-${h}-300`], `border-color: color-mix(in oklab, var(--color-${h}-500) 40%, var(--line));`);
  // พื้นสีกลาง (500/600) + ตัวขาว — ธีมมืดหรี่ลงให้ตัวขาวผ่านเกณฑ์
  out.push([500, 600].map((s2) => `${D} ${cls(`bg-${h}-${s2}`)}.text-white${NP}`).join(",\n") + ` { background-color: color-mix(in oklab, var(--color-${h}-600) 78%, #000000); }`);
}
for (const h of neutrals) {
  rule([`bg-${h}-50`, `hover:bg-${h}-50`], `background-color: var(--bg-soft);`);
  rule([`bg-${h}-100`, `hover:bg-${h}-100`], `background-color: color-mix(in oklab, var(--ink) 8%, var(--bg));`);
  rule([`bg-${h}-200`, `hover:bg-${h}-200`], `background-color: color-mix(in oklab, var(--ink) 14%, var(--bg));`);
  rule([`text-${h}-400`, `text-${h}-500`, `text-${h}-600`], `color: var(--ink-soft);`);
  rule([`text-${h}-700`, `text-${h}-800`, `text-${h}-900`, `text-${h}-950`], `color: var(--ink);`);
  rule([`border-${h}-100`, `border-${h}-200`, `border-${h}-300`], `border-color: var(--line);`);
}
// ขาว/ดำ: พื้นขาว = พื้นการ์ด · ตัวดำ = ตัวหนังสือหลัก · ตัวขาวไม่แตะ (อยู่บนปุ่มสีอยู่แล้ว)
rule(["bg-white", "hover:bg-white", "sm:bg-white", "md:bg-white", "lg:bg-white"], "background-color: var(--bg);");
for (const a of [50, 60, 70, 80, 85, 90, 95]) rule([`bg-white/${a}`], `background-color: color-mix(in oklab, var(--bg) ${a}%, transparent);`);
rule(["text-black"], "color: var(--ink);");
rule(["border-white"], "border-color: var(--bg);");

// ── สี hex ที่ใส่ตายตัวในโค้ด (bg-[#fef2f2], text-[#0F766E], style={{ backgroundColor: "#CCFBF1" }}) ──
// ไล่หาจากซอร์สทุกไฟล์ แล้วตัดสินจากความสว่าง: พื้นสว่าง → พื้นเข้มอมสีเดิม · ตัวหนังสือเข้ม → เฉดสว่างของสีเดิม
const root = path.join(__dirname, "..");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(root);
for (const extra of ["../../packages/ui/components"]) if (fs.existsSync(path.join(root, extra))) (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name)) files.push(p); } })(path.join(root, extra));

const lum = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const arb = new Set();
const inline = new Map(); // hex -> Set(prop)
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/(?:^|[\s"'`])((?:hover:)?(?:bg|text|border)-\[#[0-9a-fA-F]{3,6}\](?:\/\d{1,3})?)(?=[\s"'`])/g)) arb.add(m[1]);
  for (const m of s.matchAll(/\b(color|backgroundColor|background|borderColor)\s*:\s*["'](#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})["']/g)) {
    if (!inline.has(m[2])) inline.set(m[2], new Set());
    inline.get(m[2]).add(m[1]);
  }
}
let arbCount = 0;
for (const c of [...arb].sort()) {
  const m = c.match(/^(hover:)?(bg|text|border)-\[(#[0-9a-fA-F]{3,6})\](?:\/(\d+))?$/);
  if (!m) continue;
  const [, , kind, hex, alpha] = m;
  const L = lum(hex);
  if (kind === "bg" && L > 0.6) { rule([c], `background-color: color-mix(in oklab, ${hex} ${alpha ? Math.max(8, Math.round(Number(alpha) / 5)) : 16}%, ${alpha ? "transparent" : "var(--bg)"});`); arbCount++; }
  else if (kind === "text" && L < 0.3) { rule([c], `color: color-mix(in oklab, ${hex} 45%, #ffffff);`); arbCount++; }
  else if (kind === "border" && L > 0.5) { rule([c], `border-color: color-mix(in oklab, ${hex} 35%, var(--line));`); arbCount++; }
}
// inline style: สีที่ส่งเป็นข้อมูล (manifest colorBg, palette ของป้าย, สีปฏิทิน …) ไปลง style={{…}}
// ไล่เก็บ hex ทุกตัวในสตริงของโค้ด แล้วจับด้วย [style*=…] ทั้งแบบที่ React เขียนตอน SSR ("background-color:#EEF1F6")
// และแบบที่เบราว์เซอร์เขียนใหม่ตอนตั้งค่าจากฝั่ง client ("background-color: rgb(238, 241, 246)") — ต้อง !important เพราะ inline ชนะคลาส
// "color:" ต้องอยู่ต้น style หรือหลัง ";" ไม่งั้นไปโดน "background-color:" ด้วย
const allHex = new Set([...inline.keys()]);
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/["'`](#[0-9a-fA-F]{6})["'`]/g)) allHex.add(m[1]);
}
const rgbOf = (hex) => { const h = hex.slice(1); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
let inlineCount = 0;
const seenHex = new Set();
for (const hexRaw of [...allHex].sort()) {
  if (hexRaw.length !== 7) continue;
  const hex = hexRaw.toLowerCase();
  if (seenHex.has(hex)) continue;
  seenHex.add(hex);
  const L = lum(hex);
  const forms = [hex, rgbOf(hex)];
  const bgSel = forms.flatMap((v) => [`${D} [style*="background-color:${v}" i]${NP}`, `${D} [style*="background-color: ${v}" i]${NP}`, `${D} [style*="background:${v}" i]${NP}`, `${D} [style*="background: ${v}" i]${NP}`]).join(",\n");
  const fgSel = forms.flatMap((v) => [`${D} [style^="color:${v}" i]${NP}`, `${D} [style^="color: ${v}" i]${NP}`, `${D} [style*=";color:${v}" i]${NP}`, `${D} [style*="; color: ${v}" i]${NP}`]).join(",\n");
  const bdSel = forms.flatMap((v) => [`${D} [style*="border-color:${v}" i]${NP}`, `${D} [style*="border-color: ${v}" i]${NP}`]).join(",\n");
  if (L > 0.6) { out.push(`${bgSel} { background-color: color-mix(in oklab, ${hex} 16%, var(--bg)) !important; }`); out.push(`${bdSel} { border-color: color-mix(in oklab, ${hex} 35%, var(--line)) !important; }`); inlineCount += 2; }
  if (L < 0.3) { out.push(`${fgSel} { color: color-mix(in oklab, ${hex} 45%, #ffffff) !important; }`); inlineCount++; }
}
console.log(`files ${files.length} · arbitrary hex classes ${arb.size} (rules ${arbCount}) · inline hex ${inline.size} (rules ${inlineCount})`);

// ── พื้นปุ่ม/ป้ายที่ใช้สีเน้นเป็นพื้น + ตัวขาว (bg-(--brand-green), bg-(--danger,#dc2626) …) ──
// ในธีมมืดโทเคนสีเน้นถูกยกให้สว่าง (เพื่อใช้เป็นตัวหนังสือ) — พื้นปุ่มจึงต้องหรี่ลงให้ตัวขาวยังอ่านได้ (แบบ GitHub: fg สว่าง · fill เข้ม)
const FILL_TOKENS = ["brand-green", "brand-green-dark", "chart-blue", "chart-green", "chart-red", "chart-violet", "chart-amber", "brand-navy", "danger", "app", "app-accent", "module-color", "chat-accent", "chat-accent-strong", "tone-ok", "tone-info", "tone-warn", "tone-danger", "mod-hr", "mod-maintenance", "mod-financial"];
const fills = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:^|[\s"'`])((?:hover:|sm:|md:|data-\[[^\]]+\]:|has-\[:checked\]:)?bg-(?:\(--([a-z-]+)(?:,[^)\s]*)?\)|\[var\(--([a-z-]+)(?:,[^)\s]*)?\)\]))(?=[\s"'`])/g)) {
    const tok = m[2] || m[3];
    if (FILL_TOKENS.includes(tok)) fills.add(m[1]);
  }
}
for (const c of [...fills].sort()) {
  const tok = (c.match(/--([a-z-]+)/) || [])[1];
  const base = tok === "brand-navy" ? "var(--brand-navy-fill)" : `color-mix(in oklab, var(--${tok}) 62%, #000000)`;
  const dm = c.match(/^data-\[([^\]]+)\]:/);
  const state = c.startsWith("hover:") ? ":hover" : c.startsWith("has-[:checked]:") ? ":has(:checked)" : dm ? (dm[1].includes("=") ? `[data-${dm[1].replace("=", '="')}"]` : `[data-${dm[1]}]`) : "";
  out.push(`${D} ${cls(c)}${state}${NP} { background-color: ${base}; }`);
}
console.log("fill classes", fills.size);
// สีเน้นที่ส่งเป็น style={{ backgroundColor: "var(--app-accent)" }} (ปุ่มลอย Fab, ป้ายปฏิทิน PM …) — หรี่แบบเดียวกับคลาส
for (const tok of FILL_TOKENS) {
  const base = tok === "brand-navy" ? "var(--brand-navy-fill)" : `color-mix(in oklab, var(--${tok}) 62%, #000000)`;
  const sel = ["background-color:var(--", "background-color: var(--", "background:var(--", "background: var(--"].map((p) => `${D} [style*="${p}${tok})"]${NP}`).join(",\n");
  out.push(`${sel} { background-color: ${base} !important; }`);
}

const file = path.join(__dirname, "..", "app", "theme-dark-utils.css");
fs.writeFileSync(file, `/* สร้างจาก scripts/gen-dark-utils.cjs — อย่าแก้มือ */\n${out.join("\n")}\n`);
console.log("wrote", file, out.length, "rules");
