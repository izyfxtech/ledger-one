// Captured at module evaluation time — as close to "the app started" as we
// get from JS. Used to enforce a minimum splash-screen duration (see
// @/components/lock-gate) so it reads as an intentional beat rather than a
// flicker on fast/cached boots.
export const BOOT_TIME = Date.now();
