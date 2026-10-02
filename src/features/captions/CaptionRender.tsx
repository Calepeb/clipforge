import type { CSSProperties } from 'react'
import type { CaptionStyle, Word } from '../../types/editor'
import { emojiFor, isKeyword } from '../../lib/captions'

const ANIMATION: Record<string, string | undefined> = {
  pop: 'cap-pop 260ms cubic-bezier(0.2, 0.9, 0.3, 1.3)',
  bounce: 'cap-bounce 380ms cubic-bezier(0.3, 1.4, 0.5, 1)',
  fade: 'cap-fade 240ms ease-out',
}

/**
 * Renders one caption chunk in a given style. `scale` maps the 1080px-wide export
 * coordinate space onto the current preview size.
 */
export function CaptionRender({
  style,
  words,
  time,
  scale,
  chunkKey,
}: {
  style: CaptionStyle
  words: Word[]
  time: number
  scale: number
  chunkKey?: string
}) {
  const textStyle: CSSProperties = {
    fontFamily: `'${style.fontFamily}', sans-serif`,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize * scale,
    lineHeight: 1.15,
    color: style.textColor,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    WebkitTextStroke: style.outlineWidth ? `${style.outlineWidth * 2 * scale}px ${style.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: style.shadow ? `0 ${4 * scale}px ${style.shadowBlur * scale}px rgb(0 0 0 / 0.65)` : undefined,
    animation: ANIMATION[style.animation],
    letterSpacing: style.fontFamily === 'Bebas Neue' || style.fontFamily === 'Anton' ? '0.02em' : undefined,
  }
  const visible = style.animation === 'typewriter' ? words.filter((w) => w.start <= time) : words

  return (
    <div key={chunkKey} className="text-center" style={textStyle}>
      {visible.map((w, i) => {
        const active = style.highlightMode === 'word' && time >= w.start && time < w.end
        const keyword = style.keywordEmphasis && isKeyword(w.text)
        const emoji = style.emojis ? emojiFor(w.text) : undefined
        return (
          <span key={w.id}>
            <span
              style={{
                color: active ? style.highlightColor : keyword ? style.keywordColor : undefined,
                display: 'inline-block',
                transform: active ? 'scale(1.08)' : undefined,
                transition: 'transform 90ms, color 90ms',
              }}
            >
              {w.text}
            </span>
            {emoji && <span style={{ WebkitTextStroke: 0, marginLeft: '0.15em' }}>{emoji}</span>}
            {i < visible.length - 1 && ' '}
          </span>
        )
      })}
    </div>
  )
}
