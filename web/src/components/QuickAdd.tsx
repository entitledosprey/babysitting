import { useState } from 'react';
import { QUICK_ADD_ORDER, EVENT_TYPES, typeDef } from '../lib/events';
import type { EventTypeKey } from '../lib/events';
import type { LogEvent, SessionChild } from '../lib/api';
import { Sheet } from './ui';
import { EventForm } from './EventForm';
import type { EventDraft } from './EventForm';

export function QuickAdd({ children, defaultChildId, onClose, onCreate }: {
  children: SessionChild[];
  defaultChildId?: string;
  onClose: () => void;
  onCreate: (type: string, draft: EventDraft) => Promise<void>;
}) {
  const [picked, setPicked] = useState<EventTypeKey | null>(null);

  if (!picked) {
    return (
      <Sheet title="Add an entry" onClose={onClose}>
        <div className="qa-grid">
          {QUICK_ADD_ORDER.map((key) => {
            const def = EVENT_TYPES[key];
            return (
              <button key={key} className="qa-item" style={{ ['--c' as string]: def.colour }}
                onClick={() => setPicked(key)}>
                <span className="e">{def.emoji}</span>
                <span className="l">{def.label}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
    );
  }

  const def = EVENT_TYPES[picked];
  return (
    <Sheet
      title={`${def.emoji} ${def.label}`}
      onClose={onClose}
      action={<button className="btn ghost" onClick={() => setPicked(null)}>Back</button>}
    >
      <EventForm
        def={def}
        children={children}
        defaultChildId={defaultChildId}
        submitLabel={`Save ${def.label.toLowerCase()}`}
        onSubmit={async (draft) => {
          await onCreate(picked, draft);
          onClose();
        }}
      />
    </Sheet>
  );
}

export function EditEvent({ event, children, onClose, onSave, onDelete }: {
  event: LogEvent;
  children: SessionChild[];
  onClose: () => void;
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const def = typeDef(event.type);
  return (
    <Sheet title={`${def.emoji} ${def.label}`} onClose={onClose}>
      <EventForm
        def={def}
        children={children}
        existing={event}
        submitLabel="Save changes"
        onSubmit={async (draft) => { await onSave(draft); onClose(); }}
        onDelete={async () => { await onDelete(); onClose(); }}
      />
    </Sheet>
  );
}
