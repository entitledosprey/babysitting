import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function Sheet({ title, onClose, children, action }: {
  title: string; onClose: () => void; children: ReactNode; action?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {action}
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Chips({ options, value, onChange, clearable }: {
  options: string[]; value: string | undefined; onChange: (v: string | undefined) => void; clearable?: boolean;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="chip"
          aria-pressed={value === o}
          onClick={() => onChange(clearable && value === o ? undefined : o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" className="toggle" aria-pressed={value} onClick={() => onChange(!value)}>
      <span>{label}</span>
      <span className="mark" aria-hidden="true">✓</span>
    </button>
  );
}

export function NumberPicker({ value, onChange, unit, presets, step = 1 }: {
  value: number | undefined; onChange: (v: number | undefined) => void;
  unit?: string; presets?: number[]; step?: number;
}) {
  return (
    <div className="stack tight">
      <div className="row">
        <button className="btn sm" type="button" aria-label="Less"
          onClick={() => onChange(Math.max(0, Number(((value ?? 0) - step).toFixed(2))))}>−</button>
        <input
          className="input"
          style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
          inputMode="decimal"
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v === '' ? undefined : Number(v));
          }}
        />
        <span className="muted" style={{ minWidth: 22 }}>{unit}</span>
        <button className="btn sm" type="button" aria-label="More"
          onClick={() => onChange(Number(((value ?? 0) + step).toFixed(2)))}>+</button>
      </div>
      {presets && (
        <div className="chips">
          {presets.map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={value === p} onClick={() => onChange(p)}>
              {p}{unit ? ` ${unit}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TextField({ value, onChange, placeholder, presets }: {
  value: string; onChange: (v: string) => void; placeholder?: string; presets?: string[];
}) {
  return (
    <div className="stack tight">
      <input className="input" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {presets && (
        <div className="chips">
          {presets.map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={value === p}
              onClick={() => onChange(value === p ? '' : p)}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <span className="field-label">{label}</span>
    {children}
  </div>
);

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast">{msg}</div> : null, setMsg];
}

export const Spinner = () => <div className="spin">Loading…</div>;

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}
