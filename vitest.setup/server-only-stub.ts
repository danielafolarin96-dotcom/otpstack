// vitest runs outside Next's bundler, where the real "server-only" package
// always throws (it relies on webpack/turbopack's build-time resolution to
// no-op). Aliased in vitest.config.ts so modules that import "server-only"
// stay testable.
export {};
