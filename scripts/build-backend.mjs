// Builds the frozen backend (backend/dist/clipforge-backend) with PyInstaller from backend/.venv.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const python = process.platform === 'win32' ? path.join('.venv', 'Scripts', 'python.exe') : path.join('.venv', 'bin', 'python')
const r = spawnSync(python, ['-m', 'PyInstaller', 'clipforge-backend.spec', '--noconfirm', '--log-level', 'WARN'], { cwd: 'backend', stdio: 'inherit' })
if (r.error) console.error(`Could not run ${python}: ${r.error.message}. Run \`npm run setup:backend\` first (and pip install pyinstaller).`)
process.exit(r.status ?? 1)
