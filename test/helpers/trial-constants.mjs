// I keep the Business trial length and size in one place so the docs and the
// tests read the same numbers. The values mirror the trial policy: a 14-day
// trial with one 14-day extension, defaulting to 5 members and 10 computers.

export const TRIAL_DAYS = 14;
export const TRIAL_EXT_DAYS = 14;
export const TRIAL_DEFAULTS = Object.freeze({ members: 5, computers: 10 });
