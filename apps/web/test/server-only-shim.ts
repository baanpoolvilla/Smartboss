// Vitest stand-in for the "server-only" package — that package only exists to
// throw a build-time error if a file importing it gets bundled into client
// code (see https://www.npmjs.com/package/server-only). It has no runtime
// behavior of its own, so under vitest (plain Node, never bundled for the
// browser) it can just be a no-op — see vitest.config.ts's alias for "server-only".
export {};
