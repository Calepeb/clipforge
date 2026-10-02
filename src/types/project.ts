import type { AiClip, AspectRatio, CaptionStyle, MediaAsset, MusicAsset, TimelineDoc } from './editor'

// v2: caption words are stored in source time (v1 stored timeline time).
export const PROJECT_VERSION = 2

/** Everything persisted for a project. Undo history and playback state are not saved. */
export interface ProjectFile {
  version: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  aspect: AspectRatio
  media: MediaAsset[]
  music?: MusicAsset[]
  data: {
    clips: AiClip[]
    docs: Record<string, TimelineDoc>
    styles: Record<string, CaptionStyle>
  }
  activeClipId: string | null
  /** Small JPEG data URL shown on the projects screen. */
  thumbnail?: string
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string
  clipCount: number
  mediaCount: number
}
