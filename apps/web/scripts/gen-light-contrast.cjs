// สร้าง app/theme-light-contrast.css — ธีมสว่าง: เปลี่ยน "เฉพาะสี" ตัวหนังสือ/ปุ่มที่อ่านยาก ให้ผ่าน WCAG AA (4.5:1)
// รัน: node scripts/gen-light-contrast.cjs  (ไฟล์ที่ได้ commit ไว้ — แก้กติกาที่นี่แล้วรันใหม่)
//
// ผู้ใช้ 24/11/2569: "ทำให้ไม่เปลี่ยนหน้าตาเดิม ให้อยู่รูปแบบเดิม เปลี่ยนแค่สีให้มันดูง่าย"
//  - ไม่แตะขนาด/ระยะ/เลย์เอาต์ — มีแต่ color / background-color
//  - ตัวหนังสือสีกลาง (เขียว/ฟ้า/ส้ม/เขียวอมฟ้า … ระดับ 400–600) → เฉดเข้มของสีเดิม (ระดับ 700) สีเดิมยังเป็นสีเดิม แค่เข้มขึ้น
//  - ปุ่มพื้นสีกลาง + ตัวขาว → พื้นเข้มขึ้นจากสีเดิม (color-mix กับดำ)
//  - แถบ/จุด/เส้น/พื้นอ่อนที่ไม่มีตัวหนังสือ ไม่แตะ (ไม่มีปัญหาเรื่องอ่าน)
//  - ใช้กับ [data-theme="light"] เท่านั้น — ธีมมืดมีชุดของตัวเอง (theme-dark*.css) · เอกสารพิมพ์ ([data-paper]) ไม่แตะ
const fs = require("fs");
const path = require("path");

const L = '[data-theme="light"]';
const NP = ":not([data-paper] *)";
const cls = (c) => "." + c.replace(/[^a-zA-Z0-9_-]/g, (m) => "\\" + m);
const out = ["/* สร้างจาก scripts/gen-light-contrast.cjs — อย่าแก้มือ */"];
const sel = (list) => list.map((s) => `${L} ${s}${NP}`).join(",\n");

// ── 1) คลาสสี Tailwind ตัวหนังสือระดับกลาง → 700 (เหลือง/อำพัน/ส้ม/มะนาว → 800 เพราะ 700 ยังจางบนพื้นอ่อน) ──
const hues = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const warm = new Set(["orange", "amber", "yellow", "lime"]);
for (const h of hues) {
  const to = warm.has(h) ? 800 : 700;
  const shades = h === "pink" || h === "fuchsia" || h === "purple" || h === "violet" || h === "indigo" || h === "blue" ? [400, 500] : [400, 500, 600];
  const list = shades.flatMap((s) => [`text-${h}-${s}`, `hover:text-${h}-${s}`]);
  out.push(`${sel(list.map((c) => cls(c) + (c.startsWith("hover:") ? ":hover" : "")))} { color: var(--color-${h}-${to}); }`);
}
// เทาอ่อนที่ใช้เป็นตัวหนังสือรอง (slate/gray 400) → ระดับเดียวกับ --ink-soft
for (const n of ["slate", "gray", "zinc", "neutral", "stone"]) {
  out.push(`${sel([cls(`text-${n}-400`)])} { color: var(--color-${n}-500); }`);
}

// ── 2) ตัวหนังสือที่อ้างโทเคนสีแบรนด์/โมดูล (เขียวโลโก้ #4cb93f · ฟ้า HR · เขียวอมฟ้าแจ้งซ่อม) → เข้มขึ้นจากสีเดิม ──
const darkText = (v, p = 68) => `color: color-mix(in oklab, var(${v}) ${p}%, #000);`;
for (const v of ["--brand-green", "--chart-green", "--module-color", "--app", "--app-accent", "--chat-accent", "--tone-ok"]) {
  out.push(`${sel([cls(`text-[var(${v})]`), cls(`text-(${v})`), cls(`hover:text-[var(${v})]`) + ":hover", cls(`hover:text-(${v})`) + ":hover"])} { ${darkText(v)} }`);
}
for (const v of ["--chart-amber", "--chart-orange", "--chart-yellow"]) {
  out.push(`${sel([cls(`text-[var(${v})]`), cls(`text-(${v})`)])} { ${darkText(v, 62)} }`);
}
for (const v of ["--chart-red"]) {
  out.push(`${sel([cls(`text-[var(${v})]`), cls(`text-(${v})`)])} { ${darkText(v, 82)} }`);
}
// ตัวหนังสือจาง (เลขวัน/ป้ายเล็กสีเทาอ่อน) → --ink-soft
for (const v of ["--chart-gray", "--ink-faint"]) {
  out.push(`${sel([cls(`text-[var(${v})]`), cls(`text-(${v})`)])} { color: var(--ink-soft); }`);
}
out.push(`${sel([cls("text-(--ink-faint,#7f93a6)")])} { color: var(--ink-soft); }`);

// ── 3) ปุ่ม/ป้าย: พื้นสีกลาง + ตัวขาว → พื้นเข้มขึ้นจากสีเดิม ──
const darkFill = (v, p = 74) => `background-color: color-mix(in oklab, var(${v}) ${p}%, #000);`;
for (const v of ["--brand-green", "--chart-green", "--module-color", "--app", "--app-accent", "--chat-accent", "--tone-ok"]) {
  const b = [cls(`bg-[var(${v})]`), cls(`bg-(${v})`)];
  out.push(`${sel(b.map((x) => `${x}.text-white`))} { ${darkFill(v)} }`);
}
out.push(`${sel([cls("bg-[var(--chart-red)]") + ".text-white", cls("bg-(--chart-red)") + ".text-white"])} { ${darkFill("--chart-red", 86)} }`);
out.push(`${sel([cls("bg-[var(--chart-amber)]") + ".text-white", cls("bg-(--chart-amber)") + ".text-white"])} { ${darkFill("--chart-amber", 70)} }`);
// พื้นสี Tailwind ระดับ 400–500 + ตัวขาว → ระดับ 600/700
for (const h of hues) {
  const to = warm.has(h) ? 700 : 600;
  out.push(`${sel([400, 500].map((s) => `${cls(`bg-${h}-${s}`)}.text-white`))} { background-color: var(--color-${h}-${to}); }`);
  if (warm.has(h) || h === "green" || h === "emerald" || h === "teal" || h === "cyan" || h === "sky") {
    out.push(`${sel([`${cls(`bg-${h}-600`)}.text-white`])} { background-color: var(--color-${h}-700); }`);
  }
}

// คลาสที่เขียนสีสำรองไว้ในวงเล็บ (bg-(--brand-green,#16a34a)) — ชื่อคลาสตรงตัว ไม่ใช่ hover:
out.push(`${sel(["bg-(--brand-green,#16a34a)", "bg-[var(--brand-green,#22c55e)]", "bg-(--chat-accent,var(--accent))"].map((c) => `${cls(c)}.text-white`))} { background-color: color-mix(in oklab, var(--brand-green) 74%, #000); }`);
out.push(`${sel([cls("bg-(--chat-accent,var(--accent))") + ".text-white"])} { background-color: color-mix(in oklab, var(--chat-accent) 74%, #000); }`);
out.push(`${sel([cls("bg-[var(--chart-red,#dc2626)]") + ".text-white"])} { background-color: #b91c1c; }`);
// ปุ่มลอย (Fab ใน app-scaffold) พื้น --app-accent ตัวขาว — แจ้งซ่อม #14b8a6 ได้แค่ 2.5:1
out.push(`${sel(['.text-white[style*="background-color: var(--app-accent"]', '.text-white[style*="background-color:var(--app-accent"]'])} { background-color: color-mix(in oklab, var(--app-accent, var(--brand-navy)) 70%, #000) !important; }`);

// ── 4) สี hex ที่ใส่ตายตัวในโค้ด (style={{ color: "#3B82F6" }} · text-[#16a34a]) → เฉดเข้มของสีเดิม ──
// [style^="color: …"] / [style*="; color: …"] = เฉพาะสีตัวหนังสือ (ไม่โดน background-color ที่มีคำว่า color อยู่ข้างใน)
const HEX = {
  "#3b82f6": "#1d4ed8", "#60a5fa": "#1d4ed8", "#2563eb": "#1d4ed8",
  "#16a34a": "#15803d", "#22c55e": "#15803d", "#4cb93f": "#2f7d24", "#2fa84f": "#1f7a39",
  "#0d9488": "#0f766e", "#14b8a6": "#0f766e", "#10b981": "#047857", "#059669": "#047857",
  "#ea580c": "#c2410c", "#f97316": "#c2410c", "#fb923c": "#c2410c",
  "#d97706": "#b45309", "#f59e0b": "#b45309", "#eab308": "#a16207", "#ca8a04": "#a16207",
  "#8b5cf6": "#6d28d9", "#a855f7": "#7e22ce", "#ec4899": "#be185d", "#06b6d4": "#0e7490", "#0ea5e9": "#0369a1",
  "#ef4444": "#b91c1c", "#dc2626": "#b91c1c", "#f43f5e": "#be123c",
  "#94a3b8": "#64748b", "#9ca3af": "#6b7280", "#b0bec5": "#64748b", "#a5b0c2": "#64748b", "#7f93a6": "#64748b", "#9e9e9e": "#6b7280",
};
const rgb = (hex) => { const h = hex.slice(1); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
for (const [from, to] of Object.entries(HEX)) {
  const r = rgb(from);
  const forms = [`[style^="color: ${r}"]`, `[style*="; color: ${r}"]`, `[style^="color:${from}" i]`, `[style*=";color:${from}" i]`, cls(`text-[${from}]`), cls(`text-[${from.toUpperCase()}]`)];
  out.push(`${sel(forms)} { color: ${to} !important; }`);
}
// ปุ่มพื้น hex สีกลาง + ตัวขาว (เช่น ปุ่ม "+ เพิ่ม" แจ้งซ่อม #14b8a6)
const FILL = { "#14b8a6": "#0f766e", "#0d9488": "#0f766e", "#4cb93f": "#2f7d24", "#2fa84f": "#1f7a39", "#3b82f6": "#2563eb", "#22c55e": "#15803d", "#f97316": "#c2410c", "#ef4444": "#dc2626", "#f59e0b": "#b45309" };
for (const [from, to] of Object.entries(FILL)) {
  const r = rgb(from);
  out.push(`${sel([`${cls(`bg-[${from}]`)}.text-white`, `${cls(`bg-[${from.toUpperCase()}]`)}.text-white`, `.text-white[style*="background-color: ${r}"]`, `.text-white[style*="background: ${r}"]`, `.text-white[style*="background-color:${from}" i]`, `.text-white[style*="background:${from}" i]`])} { background-color: ${to} !important; }`);
}

fs.writeFileSync(path.join(__dirname, "../app/theme-light-contrast.css"), out.join("\n") + "\n");
console.log(`theme-light-contrast.css: ${out.length - 1} rules`);
