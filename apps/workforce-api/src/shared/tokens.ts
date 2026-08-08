/** DI token สำหรับ dependency ที่เป็น interface (TypeScript interface ไม่มีตัวตนตอน runtime) */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
export const CLOCK = Symbol('CLOCK');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
