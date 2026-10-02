export type Corner = 'tl' | 'tr' | 'bl' | 'br'

export interface BrandKit {
  watermark: {
    enabled: boolean
    path: string
    corner: Corner
    /** Width as a fraction of the frame width. */
    size: number
    opacity: number
  } | null
  /** Caption/hook font. `path` is set for a custom font file copied into the brand folder. */
  font: { family: string; path?: string } | null
  colors: {
    text: string
    highlight: string
    outline: string
    keyword: string
    hookBackground: string
  }
}

export const DEFAULT_BRAND: BrandKit = {
  watermark: null,
  font: null,
  colors: { text: '#ffffff', highlight: '#ffd23f', outline: '#000000', keyword: '#3ee08f', hookBackground: '#e2366f' },
}
