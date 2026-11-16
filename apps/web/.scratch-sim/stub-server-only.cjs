// ให้สคริปต์ทดสอบ (tsx) import โมดูลที่มี "server-only" ได้ โดยไม่ต้องใช้ --conditions=react-server
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./empty.cjs");
  return orig.call(this, request, ...rest);
};
