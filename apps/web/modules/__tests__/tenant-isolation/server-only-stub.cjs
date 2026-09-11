// server-only ปกติ throw เสมอนอก build ของ Next (ดูคอมเมนต์ใน user-guards.test.ts
// ที่ต้องการ require ไฟล์ data-layer จริงซึ่งมี `import "server-only"` กันไว้ —
// ตั้งใจ ไม่ใช่ช่องโหว่ เพราะเทสต์นี้รันบน Node ตรง ๆ ไม่ผ่าน Next bundler เลย)
// preload script นี้ทำให้ require("server-only") คืน module ว่างแทนที่จะ throw
// เฉพาะตอนรันเทสต์ในโฟลเดอร์นี้เท่านั้น (ผ่าน --require ที่ package.json script)
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.apply(this, arguments);
};
