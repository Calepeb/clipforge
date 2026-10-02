import { create } from 'zustand'

interface UpdateState {
  status: UpdateStatus | null
  init: () => void
}

/** Mirrors the main process updater (electron/updater.ts). */
export const useUpdates = create<UpdateState>((set) => ({
  status: null,
  init: () => {
    const api = window.clipforge?.updates
    if (!api) return
    void api.status().then((status) => set({ status }))
    api.onStatus((status) => set({ status }))
  },
}))
