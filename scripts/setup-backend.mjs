// Creates backend/.venv with Python 3.11 and installs the backend's dependencies.
// GPU libraries are added automatically when an NVIDIA GPU is detected.
// Usage: npm run setup:backend
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const win = process.platform === 'win32'
const venv = path.join('backend', '.venv')
const venvPython = win ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

function findPython() {
  const candidates = win ? [['py', ['-3.11']], ['python', []]] : [['python3.11', []], ['python3', []]]
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' })
    const v = r.stdout?.trim()
    if (r.status === 0 && (v === '3.11' || v === '3.12')) return [cmd, pre]
  }
  console.error('Python 3.11 (or 3.12) not found. Install it first — see README "Requirements".')
  process.exit(1)
}

if (!existsSync(venvPython)) {
  const [cmd, pre] = findPython()
  run(cmd, [...pre, '-m', 'venv', venv])
}
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run(venvPython, ['-m', 'pip', 'install', '-r', path.join('backend', 'requirements.txt')])

const hasNvidia = process.platform !== 'darwin' && spawnSync('nvidia-smi', ['-L']).status === 0
if (hasNvidia) {
  console.log('\nNVIDIA GPU detected — installing CUDA libraries for faster transcription.')
  run(venvPython, ['-m', 'pip', 'install', '-r', path.join('backend', 'requirements-gpu.txt')])
} else {
  console.log('\nNo NVIDIA GPU detected — transcription will run on the CPU.')
}
console.log('\nBackend ready. The Whisper model downloads automatically on first use.')
