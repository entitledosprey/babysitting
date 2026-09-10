export type EventTypeKey =
  | 'nap' | 'feeding' | 'bottle' | 'snack' | 'water' | 'diaper' | 'potty'
  | 'activity' | 'bath' | 'medication' | 'photo' | 'note' | 'incident'
  | 'quiet_time' | 'screen_time' | 'milestone';

export type Field =
  | { kind: 'toggle'; key: string; label: string; default?: boolean }
  | { kind: 'chips'; key: string; label: string; options: string[]; default?: string; clearable?: boolean }
  | { kind: 'number'; key: string; label: string; unit?: string; presets?: number[]; step?: number }
  | { kind: 'text'; key: string; label: string; placeholder?: string; presets?: string[] };

export interface EventTypeDef {
  key: EventTypeKey;
  label: string;
  emoji: string;
  colour: string;
  /** May span a time range and render as a block on the timeline. */
  duration: boolean;
  /** Duration types offering a live Start → Stop flow rather than a time range. */
  stopwatch?: boolean;
  fields: Field[];
  notePlaceholder?: string;
  /** One-line description shown on the timeline block and in lists. */
  summary?: (detail: Record<string, unknown>) => string;
}

const yesNo = (v: unknown) => v === true;

export const EVENT_TYPES: Record<EventTypeKey, EventTypeDef> = {
  nap: {
    key: 'nap', label: 'Nap', emoji: '😴', colour: '#4a7fe0', duration: true, stopwatch: true,
    fields: [
      { kind: 'chips', key: 'fellAsleep', label: 'Fell asleep', clearable: true,
        options: ['independently', 'with rocking', 'with a pacifier', 'held', 'in the stroller'] },
      { kind: 'toggle', key: 'difficultToSettle', label: 'Difficult to settle' },
      { kind: 'toggle', key: 'wokeBriefly', label: 'Woke briefly' },
      { kind: 'chips', key: 'moodOnWaking', label: 'Mood on waking', clearable: true,
        options: ['happy', 'calm', 'groggy', 'fussy', 'crying'] },
    ],
    notePlaceholder: 'Anything worth mentioning about this nap',
    summary: (d) => [d.fellAsleep && `fell asleep ${d.fellAsleep}`, d.moodOnWaking && `woke ${d.moodOnWaking}`]
      .filter(Boolean).join(' · '),
  },
  feeding: {
    key: 'feeding', label: 'Feeding', emoji: '🍼', colour: '#d9a406', duration: true,
    fields: [
      { kind: 'text', key: 'food', label: 'What', placeholder: 'e.g. pasta and peas',
        presets: ['Breakfast', 'Lunch', 'Dinner'] },
      { kind: 'chips', key: 'amountEaten', label: 'Amount eaten', default: 'most',
        options: ['all of it', 'most', 'some', 'a little', 'none'] },
    ],
    summary: (d) => [d.food, d.amountEaten && `ate ${d.amountEaten}`].filter(Boolean).join(' · '),
  },
  bottle: {
    key: 'bottle', label: 'Bottle', emoji: '🍼', colour: '#e8794a', duration: false,
    fields: [
      { kind: 'number', key: 'amountOz', label: 'Amount', unit: 'oz', presets: [2, 3, 4, 5, 6, 8], step: 0.5 },
      { kind: 'chips', key: 'contents', label: 'Contents', default: 'formula',
        options: ['formula', 'breast milk', 'whole milk', 'other'] },
      { kind: 'toggle', key: 'finished', label: 'Finished the bottle', default: true },
    ],
    summary: (d) => [d.amountOz && `${d.amountOz} oz`, d.contents].filter(Boolean).join(' '),
  },
  snack: {
    key: 'snack', label: 'Snack', emoji: '🍎', colour: '#c98a2b', duration: false,
    fields: [
      { kind: 'text', key: 'food', label: 'What', placeholder: 'e.g. apple slices',
        presets: ['Fruit', 'Crackers', 'Yogurt', 'Cheese', 'Veggies'] },
    ],
    summary: (d) => String(d.food ?? ''),
  },
  water: {
    key: 'water', label: 'Water', emoji: '💧', colour: '#35a3c4', duration: false,
    fields: [{ kind: 'number', key: 'amountOz', label: 'Amount', unit: 'oz', presets: [2, 4, 6, 8], step: 1 }],
    summary: (d) => (d.amountOz ? `${d.amountOz} oz` : ''),
  },
  diaper: {
    key: 'diaper', label: 'Diaper', emoji: '🧷', colour: '#3fa66a', duration: false,
    fields: [
      { kind: 'toggle', key: 'wet', label: 'Wet', default: true },
      { kind: 'toggle', key: 'dirty', label: 'Dirty' },
      { kind: 'toggle', key: 'rash', label: 'Rash or redness' },
    ],
    summary: (d) => {
      const bits = [yesNo(d.wet) && 'wet', yesNo(d.dirty) && 'dirty'].filter(Boolean);
      return (bits.length ? bits.join(' + ') : 'dry') + (yesNo(d.rash) ? ' · rash' : '');
    },
  },
  potty: {
    key: 'potty', label: 'Potty', emoji: '🚽', colour: '#e0699b', duration: false,
    fields: [
      { kind: 'toggle', key: 'pee', label: 'Pee', default: true },
      { kind: 'toggle', key: 'poop', label: 'Poop' },
      { kind: 'toggle', key: 'accident', label: 'Accident' },
    ],
    summary: (d) => {
      const bits = [yesNo(d.pee) && 'pee', yesNo(d.poop) && 'poop'].filter(Boolean);
      return (bits.length ? bits.join(' + ') : 'tried') + (yesNo(d.accident) ? ' · accident' : '');
    },
  },
  activity: {
    key: 'activity', label: 'Activity', emoji: '🧸', colour: '#8a5cd6', duration: true, stopwatch: true,
    fields: [
      { kind: 'chips', key: 'kind', label: 'Kind', default: 'Free play',
        options: ['Free play', 'Reading', 'Outside play', 'Art', 'Music', 'Walk', 'Blocks', 'Pretend play'] },
    ],
    summary: (d) => String(d.kind ?? ''),
  },
  bath: {
    key: 'bath', label: 'Bath', emoji: '🛁', colour: '#8b6b4a', duration: true,
    fields: [{ kind: 'toggle', key: 'hairWashed', label: 'Washed hair' }],
    summary: (d) => (yesNo(d.hairWashed) ? 'hair washed' : ''),
  },
  medication: {
    key: 'medication', label: 'Medication', emoji: '💊', colour: '#d64545', duration: false,
    fields: [
      { kind: 'text', key: 'name', label: 'Medication', placeholder: 'e.g. Children’s Tylenol' },
      { kind: 'text', key: 'dose', label: 'Dose', placeholder: 'e.g. 5 ml' },
      { kind: 'chips', key: 'givenBy', label: 'Given', default: 'as instructed',
        options: ['as instructed', 'parent asked at the time'] },
    ],
    notePlaceholder: 'Reason it was given, and anything you noticed after',
    summary: (d) => [d.name, d.dose].filter(Boolean).join(' · '),
  },
  photo: {
    key: 'photo', label: 'Photo', emoji: '📸', colour: '#5b8def', duration: false,
    fields: [],
    notePlaceholder: 'What the photo is of',
    summary: () => '',
  },
  note: {
    key: 'note', label: 'Note', emoji: '💬', colour: '#64748b', duration: false,
    fields: [],
    notePlaceholder: 'Anything you want the parents to know',
    summary: () => '',
  },
  incident: {
    key: 'incident', label: 'Incident', emoji: '🚨', colour: '#b91c1c', duration: false,
    fields: [
      { kind: 'chips', key: 'severity', label: 'Severity', default: 'minor',
        options: ['minor', 'moderate', 'serious'] },
      { kind: 'text', key: 'actionTaken', label: 'Action taken',
        placeholder: 'e.g. cleaned and applied a bandage',
        presets: ['Comforted', 'Ice pack', 'Cleaned and bandaged', 'Called parent'] },
      { kind: 'toggle', key: 'parentNotified', label: 'Parent notified at the time' },
    ],
    notePlaceholder: 'What happened, in the parents’ words if they ask later',
    summary: (d) => String(d.severity ?? ''),
  },
  quiet_time: {
    key: 'quiet_time', label: 'Quiet Time', emoji: '💤', colour: '#7a8fc4', duration: true, stopwatch: true,
    fields: [],
    summary: () => '',
  },
  screen_time: {
    key: 'screen_time', label: 'Screen Time', emoji: '📺', colour: '#6b7280', duration: true, stopwatch: true,
    fields: [{ kind: 'text', key: 'what', label: 'What', placeholder: 'e.g. Bluey' }],
    summary: (d) => String(d.what ?? ''),
  },
  milestone: {
    key: 'milestone', label: 'Milestone', emoji: '⭐', colour: '#d4a017', duration: false,
    fields: [
      { kind: 'chips', key: 'kind', label: 'Kind', clearable: true,
        options: ['New word', 'Tried a new food', 'Used the potty', 'Played well with others',
                  'Developmental milestone', 'Something funny', 'Behaviour'] },
    ],
    notePlaceholder: 'What happened — this one goes in the report',
    summary: (d) => String(d.kind ?? ''),
  },
};

/** Order of the quick-add grid: the things logged most often come first. */
export const QUICK_ADD_ORDER: EventTypeKey[] = [
  'diaper', 'bottle', 'nap', 'snack', 'feeding', 'potty',
  'water', 'activity', 'note', 'milestone', 'medication', 'bath',
  'photo', 'quiet_time', 'screen_time', 'incident',
];

export const typeDef = (key: string): EventTypeDef =>
  EVENT_TYPES[key as EventTypeKey] ?? {
    key: key as EventTypeKey, label: key, emoji: '•', colour: '#64748b',
    duration: false, fields: [],
  };

/** Defaults so a quick-add form opens already filled in. */
export function defaultDetail(def: EventTypeDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (f.kind === 'toggle' && f.default !== undefined) out[f.key] = f.default;
    if (f.kind === 'chips' && f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}
