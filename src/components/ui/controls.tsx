import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-accent text-white shadow-[0_2px_12px_-2px_rgb(255_106_61/0.5)] hover:bg-accent-hover',
        variant === 'secondary' && 'bg-raised text-fg hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-raised hover:text-fg',
        className,
      )}
    />
  )
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-fg">{format ? format(value) : `${+value.toFixed(2)}${unit}`}</span>
      </span>
      <input
        type="range"
        className="cf-range w-full"
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  )
}

const SWATCHES = ['#ffffff', '#000000', '#ffd23f', '#ff6a3d', '#e2366f', '#9b7bff', '#3ee08f', '#7cd4ff']

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line-strong" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        {SWATCHES.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => onChange(c)}
            className={clsx('h-4 w-4 rounded-full border transition-transform hover:scale-125', value.toLowerCase() === c ? 'border-accent' : 'border-white/15')}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  fontPreview,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  fontPreview?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          style={fontPreview ? { fontFamily: value } : undefined}
          className="h-8 w-full appearance-none rounded-lg border border-line bg-raised pl-2.5 pr-7 text-[13px] text-fg outline-none transition-colors hover:border-line-strong focus:border-accent"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} style={fontPreview ? { fontFamily: o.value } : undefined}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-2 text-muted" />
      </div>
    </label>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3" title={hint}>
      <span className="text-[13px] text-fg">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-[18px] w-8 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
      </button>
    </label>
  )
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs text-muted">{label}</span>}
      <div className="flex rounded-lg bg-app p-0.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
              value === o.value ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-2 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted transition-colors hover:text-fg">
          <ChevronDown size={14} className={clsx('transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {right && <div className="pr-3">{right}</div>}
      </div>
      {open && <div className="flex animate-fade-in flex-col gap-4 px-4 pb-4">{children}</div>}
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-lg', className)} />
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const color = score >= 85 ? 'bg-good text-black' : score >= 70 ? 'bg-warn text-black' : 'bg-white/80 text-black'
  return <span className={clsx('rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow', color, className)}>{score}</span>
}
