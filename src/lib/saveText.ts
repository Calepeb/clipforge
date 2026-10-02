/** Save a text file: native Save dialog in the desktop app, a download in the browser. */
export async function saveTextFile(defaultName: string, content: string, filterName: string, extensions: string[]): Promise<string | null> {
  if (window.clipforge) return window.clipforge.saveText({ defaultName, content, filterName, extensions })
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: defaultName })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return defaultName
}
