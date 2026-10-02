// App settings that live in the app data folder. The Claude API key is stored in
// <userData>/.env, which the backend loads on start (backend/clipforge/config.py).
import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const envFile = () => path.join(app.getPath('userData'), '.env')

async function readEnv(): Promise<string[]> {
  try {
    return (await fs.readFile(envFile(), 'utf8')).split(/\r?\n/)
  } catch {
    return []
  }
}

export async function hasApiKey(): Promise<boolean> {
  return (await readEnv()).some((l) => /^ANTHROPIC_API_KEY=.+/.test(l.trim()))
}

/** Save (or clear, with an empty string) the Claude API key. Never logged or sent anywhere else. */
export async function setApiKey(key: string): Promise<void> {
  const clean = key.trim()
  if (clean && !/^[\w-]{20,}$/.test(clean)) throw new Error('That doesn’t look like an Anthropic API key.')
  const lines = (await readEnv()).filter((l) => l.trim() && !l.startsWith('ANTHROPIC_API_KEY='))
  if (clean) lines.push(`ANTHROPIC_API_KEY=${clean}`)
  await fs.mkdir(path.dirname(envFile()), { recursive: true })
  await fs.writeFile(envFile(), lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
}

export const dataDir = () => app.getPath('userData')
