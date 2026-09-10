// Event taxonomy shared with the client (mirrored in web/src/lib/events.ts).
// `duration: true` means the event may carry an end_at and render as a block.
export const EVENT_TYPES = {
  feeding:     { label: 'Feeding',     emoji: '🍼', duration: true  },
  bottle:      { label: 'Bottle',      emoji: '🍼', duration: false },
  snack:       { label: 'Snack',       emoji: '🍎', duration: false },
  water:       { label: 'Water',       emoji: '💧', duration: false },
  diaper:      { label: 'Diaper',      emoji: '🧷', duration: false },
  potty:       { label: 'Potty',       emoji: '🚽', duration: false },
  nap:         { label: 'Nap',         emoji: '😴', duration: true  },
  medication:  { label: 'Medication',  emoji: '💊', duration: false },
  activity:    { label: 'Activity',    emoji: '🧸', duration: true  },
  bath:        { label: 'Bath',        emoji: '🛁', duration: true  },
  photo:       { label: 'Photo',       emoji: '📸', duration: false },
  note:        { label: 'Note',        emoji: '💬', duration: false },
  incident:    { label: 'Incident',    emoji: '🚨', duration: false },
  quiet_time:  { label: 'Quiet Time',  emoji: '💤', duration: true  },
  screen_time: { label: 'Screen Time', emoji: '📺', duration: true  },
  milestone:   { label: 'Milestone',   emoji: '⭐', duration: false },
};

export const isValidType = (t) => Object.hasOwn(EVENT_TYPES, t);
