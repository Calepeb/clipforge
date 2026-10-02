import clsx from 'clsx'

export function MenuItem({ icon, children, onClick, danger, shortcut }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; shortcut?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-raised', danger ? 'text-bad' : 'text-fg')}
    >
      <span className={danger ? '' : 'text-muted'}>{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[11px] text-faint">{shortcut}</span>}
    </button>
  )
}
