# ClipForge

Desktop app that turns long MP4s into 6–12 vertical, captioned, TikTok-ready clips.

**Status: all 8 phases built** — import → transcribe → find viral moments → captions → edit → auto-reframe → tighten, music, brand kit → batch export.

| Phase | Scope | Status |
|---|---|---|
| 1 | App shell + editor layout (mock data) | ✅ |
| 2 | Import + transcription (FastAPI sidecar, faster-whisper) | ✅ (+ Claude hooks/titles from Phase 3) |
| 3 | Viral clip detection (Claude + audio energy + scenes) | ✅ |
| 4 | Auto-captions + presets (ASS burn-in) | ✅ |
| 5 | Timeline editing (word-snapped trims, merge, ripple) | ✅ |
| 6 | Auto-reframe (MediaPipe face tracking) | ✅ |
| 7 | Export queue (1080×1920 H.264/AAC + .srt) | ✅ |
| 8 | Silence/filler removal, music ducking, brand kit | ✅ |

## Requirements

| Tool | Version | Needed from |
|---|---|---|
| Node.js | 20+ (tested on 24) | Phase 1 |
| FFmpeg | 6+ on `PATH` | Phase 1 (mock video), all later phases |
| Python | 3.11 (3.12 OK; MediaPipe/faster-whisper wheels lag newer versions). Windows: `winget install --id Python.Python.3.11 -e`; macOS: `brew install python@3.11` | Phase 2 |
| NVIDIA GPU + CUDA 12 / cuDNN 9 | optional | Phase 2 (faster transcription; CPU fallback otherwise) |

### Installing FFmpeg

**Windows**
```bash
winget install --id Gyan.FFmpeg -e
```
Then open a new terminal and check `ffmpeg -version`.

**macOS**
```bash
brew install ffmpeg
```

## Setup

```bash
npm install
```

```bash
npm run setup:backend
```

```bash
npm run fetch:fonts
```
Downloads the caption fonts (Montserrat, Poppins, Inter, Bebas Neue, Anton; SIL Open Font License) from the official google/fonts repository into `public/fonts`. The editor preview and the FFmpeg renderer both use these files.
Creates `backend/.venv` and installs the Python backend (faster-whisper, FastAPI, Anthropic SDK). On machines with an NVIDIA GPU it also installs the CUDA 12 / cuDNN 9 libraries. The Whisper model (about 1.5 GB for `medium`) downloads automatically the first time you generate clips.

For Claude-written hooks and titles, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without it, hooks come from each clip's opening line.

```bash
npm run mock:video
```
Generates `public/mock/sample.mp4` (2-minute test pattern with a tone) used as the mock source.

```bash
npm run dev
```
Starts Vite, opens the Electron window, and launches the Python backend in the background (127.0.0.1 only, random port, per-launch token). Use `npm run dev:web` to run the UI in a normal browser at http://localhost:5173 instead (no Electron APIs).

Other scripts: `npm run typecheck`, `npm run build`.

## Generating clips

Import a video in **Media**, then in **AI Clips** set the number of clips (6–12) and the min/max clip length (default 15–90 s), and press **Generate clips**. Progress and a **Cancel** button show under the button and in the jobs menu.

The pipeline (`backend/clipforge`):

| Step | Module | What it does |
|---|---|---|
| Transcribe | `transcription.py` | faster-whisper with word timestamps and language detection. GPU if usable, otherwise CPU. |
| Audio energy | `analysis/audio.py` | Loudness every 0.5 s compared to the speaker's baseline; spikes ≈ reactions, laughter, raised voices. Runs in parallel with transcription. |
| Scenes & motion | `analysis/scenes.py` | PySceneDetect ContentDetector: cut times and per-second frame change. Runs in parallel with transcription. |
| Claude analysis | `analysis/llm.py` | Reads the numbered transcript in ~8-minute overlapping chunks (4 in parallel) and proposes moments with 0–10 scores for hook, opinion, humor, emotion, surprise and story arc, an overall virality rating, plus hook text, title, reason and hashtags. |
| Score | `analysis/scoring.py` + `scoring_weights.toml` | Combines the signals into one 0–100 score. Edit the TOML to tune; changes apply on the next run. |
| Select | `analysis/selection.py` | Sentence-aligned, non-overlapping clips within the length limits, starting on the hook and ending on a full sentence. If fewer clips fit than requested, you get as many as possible and a note explaining why. |

Each clip opens with real word-timed captions and its hook as a text layer. Select a clip to see its **Score breakdown** (Claude / transcript / audio / visual) in the properties panel. Without an API key, or if Claude is unreachable, clips are still produced from the other signals and the app tells you so.

Analysis results (transcript, audio, scenes) are cached per file, so regenerating with different settings is quick. The sample project and browser-only mode (`dev:web`) have no real file to analyse, so they use demo clips.

Backend logs: see "Troubleshooting" below.

## Timeline editing

- **Captions follow the video.** Caption words are stored in source-video time and mapped through the video segments, so trimming, splitting, moving or deleting video carries the captions along; words under removed footage disappear (and return on undo).
- **Trim handles snap** to word boundaries, the playhead and other items' edges (toggle with the magnet button). When you extend a clip past its original range, captions for the newly revealed footage are added from the video's full transcript.
- **Ripple delete**: deleting a video segment closes the gap and shifts later items left. Shift+Delete leaves the gap.
- **Merge** (M or the link button) rejoins a segment with the next one when they continue each other in the source, e.g. after a split.
- Captions can be retimed by dragging (or trimming) a caption block, and fixed by double-clicking it or editing the transcript list.

Projects created before this version are converted automatically when opened. Clips generated before it don't have the full transcript stored, so extending them won't add captions until you regenerate.

## Auto-reframe

After clips are generated, ClipForge frames each one in the background (`backend/clipforge/reframe`):

1. Frames are sampled at 5 fps and run through **MediaPipe Face Landmarker**, which gives each face's box and a `jawOpen` score. The model (~4 MB) downloads from Google's model storage on first use.
2. Faces are linked into tracks; the **active speaker** is the face whose mouth is moving most, with hysteresis (another person must clearly out-talk them for 1 s) so the camera doesn't flicker.
3. The camera holds still inside a small dead zone, eases toward the subject when they move (max ~⅓ of the frame width per second), and **cuts** when the active speaker changes to someone far away. The path is simplified into keyframes.
4. Each clip gets a recommended mode:
   - **Track**: follow the speaker (one person, or calm turn-taking).
   - **Split**: two people too far apart for one crop who talk over each other or trade lines rapidly — stacked top/bottom, each half centred on one person.
   - **Blur**: no faces (screen recordings, animation) — the whole frame on a blurred background.
   - **Center**: the source already has the output's shape.

The preview and the FFmpeg render follow the same path (the render animates the crop with a per-frame expression). In the properties panel's **Framing** section you can re-run **Auto-reframe**, pick another mode, or choose **Use manual focus** to set the position yourself.

## Effects (Effects tab)

Per clip; **Apply these effects to all clips** copies them to every clip. Preview and export use the same numbers (`src/lib/effects.ts` computes them; `backend/clipforge/render/clip.py` applies them).

- **Auto zoom** — punch-in zoom cuts on every other sentence, on attention-grabbing keywords, or on a timer; amount 1.05–1.4×. Export: `zoompan`, preview: centre scale.
- **Colour** — looks (Vivid, Warm, Cool, Cinematic, B&W, Matte, Punchy) plus brightness, contrast, saturation and warmth. One affine colour map in sRGB: an SVG `feColorMatrix` in the preview, `colorchannelmixer` + `lutrgb` in the export.
- **Vignette** — the same radial gradient in both (the export bakes it into an overlay image).
- **Fade in / fade out** from/to black (video and audio).
- **Normalize loudness** — to −14 LUFS (`loudnorm`), the level short-form apps play at; applied on export.
- **Cleanup** (silences & fillers) and **progress bar**, as before.

## Extras

- **Remove silences & fillers** (Effects tab, or Cleanup in a clip's properties; "Tighten all clips" for every clip): cuts "um", "uh", "erm"… and shortens pauses longer than 0.5 s to 0.2 s by splitting the video into segments. Captions, text layers and music follow the cuts. Switching it off restores the exact cut from before (or use undo). Whisper is prompted to keep filler words in the transcript so they can be found; clips transcribed before this version need **Regenerate clips** for that.
- **Background music** (Audio tab): import your own tracks (MP3, M4A, AAC, WAV, OGG, FLAC — use music you have the rights to), then add one to a clip or to all clips. It loops if shorter than the clip, has fade in/out and volume controls, and **auto-ducks** under speech: the music dips by the chosen amount whenever a caption word is spoken. The export uses the same speech timings as the preview, so the dip matches exactly (verified: 70% → −10.4 dB in the export vs −10.5 dB in the preview).
- **Brand kit** (Templates tab, saved for all projects in the app data folder): a watermark/logo image (corner, size, opacity, on/off), a caption & hook font — one of the bundled fonts or your own .ttf/.otf — and caption/keyword/outline/hook colours. **Apply to all clips** sets the font and colours (undoable); newly generated clips get them automatically; the watermark appears on every clip in the preview and the export while it's on. Imported images and fonts are copied into the brand folder, so moving the originals doesn't break anything.

## Captions

Captions come from the word timestamps and are styled in **Text & Captions** (presets) or the properties panel when a caption is selected: font, size, weight, colors, word highlight, keyword colours, auto emojis, outline, shadow, words at a time (1–3), position (or drag them in the preview) and animation (pop, bounce, fade, typewriter). Apply a style to one clip or all clips. Fix transcription mistakes in the transcript list or by double-clicking a caption on the timeline.

**Burned-in rendering** (`backend/clipforge/captions`, `backend/clipforge/render`): captions and text layers are written as an ASS subtitle file and burned in by FFmpeg/libass, after the framing step, with the progress bar on top. Output is 1080×1920 (or 1080×1080 / 1920×1080), H.264 + AAC, 30 fps, using the NVIDIA NVENC encoder when available and libx264 otherwise. Font sizes are converted so libass text matches the CSS preview (verified to within 1 px).

- **Export** (top-right button): pick the clips (checkboxes in AI Clips or in the dialog), the folder (default `Videos\ClipForge\<project>`, remembered once you choose one) and whether to save .srt files. Clips render one at a time in a queue you can watch, cancel or retry; it keeps running if you close the dialog (progress is also in the jobs menu). Each clip becomes `<title>.mp4` (+ `<title>.srt`); existing files are never overwritten (`Title (2).mp4`), and unfinished exports never leave partial files. The edit is captured when you click Export, so you can keep working meanwhile.
- **Output format**: H.264 High@4.2, 30 fps, 2-second keyframe interval, bitrate capped at 15 Mbps, AAC 48 kHz, fast-start MP4 — what TikTok, Reels and Shorts ingest without re-processing surprises.
- **Render check** (clapperboard button under the preview): renders the open clip exactly as export will and plays it, so you can compare it with the live preview.
- **.srt export**: the **.srt** button in the Captions tab saves subtitles with the same caption chunks.

Known differences from the preview: libass has no shadow blur (shadows are hard-edged), emojis render in monochrome, the hook box has square corners, and entrance animations are approximations of the CSS ones.

## Projects

- The app opens on the **Projects** screen: start a **New project** (click it, or drop videos onto it to import them right away), try the **sample**, or open a recent project.
- Projects **save automatically** about 1.5 s after each change, and before the window closes. The indicator next to the project name shows Saved / Unsaved / Saving…; click it to save immediately.
- **File** menu in the editor: New project, All projects, Save now, Duplicate project, Show projects folder. Rename, duplicate or delete from a project card's **⋯** menu on the Projects screen (deleted projects go to the Recycle Bin / Trash).
- Project files are stored as `<id>.clipforge.json` in:
  - Windows: `%APPDATA%\ClipForge\projects`
  - macOS: `~/Library/Application Support/ClipForge/projects`
- Imported videos are **not copied**; the project stores their file path. If a video is moved or deleted, it shows as "File not found" in Media.
- In `npm run dev:web` (browser only), projects are kept in localStorage and imported videos can't be reopened after a reload.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Ctrl/⌘ + S | Save now |
| Ctrl/⌘ + N | New project |
| Ctrl/⌘ + O | All projects |
| Space | Play / pause |
| S | Split selected item (or the video under the playhead) |
| M | Merge the selected video segment with the next one (after a split) |
| Delete / Backspace | Delete selection; deleting video closes the gap (ripple) |
| Shift + Delete | Delete video and keep the gap |
| Ctrl/⌘ + Z | Undo |
| Ctrl/⌘ + Shift + Z, Ctrl + Y | Redo |
| ← / → | Step one frame (Shift: one second) |
| + / − | Zoom timeline (or Ctrl/⌘ + mouse wheel) |
| Esc | Deselect |

Double-click a caption on the timeline to fix its text; or edit it in **Captions → Transcript**.

## Project layout

```
electron/            main process, preload, project files (projects.ts), cf-media:// protocol (media.ts), backend supervisor (backend.ts)
src/
  app shell          App.tsx, main.tsx, index.css (theme tokens)
  components/ui/     buttons, sliders, color fields, sections, toasts, logo
  features/
    topbar/          project name, undo/redo, aspect, jobs indicator, export
    left-panel/      icon rail + tab host
    media/ ai-clips/ captions/ audio/ effects/ templates/
    preview/         phone frame, canvas reframing, caption/text overlays, transport
    properties/      context-sensitive inspector
    timeline/        tracks, ruler, playhead, drag/trim/snap, waveforms
    export/          export dialog + queue
    home/            projects screen (new, open, rename, duplicate, delete)
  stores/            editorStore (undoable project data), projectStore (save/open/autosave), uiStore (tabs, toasts, jobs)
  lib/               captions (chunking, presets), media (thumbs, waveforms), time, shortcuts
  mocks/             Phase 1 mock clips/transcripts
scripts/             helper scripts (mock video; model download from Phase 2)
backend/clipforge/   FastAPI sidecar: transcription.py (faster-whisper), clips.py (moment picking + weights), hooks.py (Claude copy), jobs.py, main.py
```

### Notes on the design
- **Undo/redo**: all clip, timeline and caption-style edits go through `useEditor().commit()`, which stores immutable snapshots. Continuous gestures (drags, sliders) are merged into one undo step.
- **Preview vs export**: the preview draws video frames to a canvas using the clip's framing settings and renders captions in the DOM. From Phase 4 the exporter renders the same settings with FFmpeg + ASS subtitles, using the same bundled fonts.
- **Thumbnails/waveforms** are generated in the browser in Phase 1. From Phase 2 the backend produces them with FFmpeg, which is much faster for long videos.
- `.env` (from `.env.example`) will hold `ANTHROPIC_API_KEY` from Phase 3. It is git-ignored and never hard-coded.

## Building the installer locally

```bash
npm run dist
```

Produces `release/ClipForge Setup <version>.exe` (plus an unpacked copy in `release/win-unpacked`). Prerequisites: `npm run setup:backend`, `npm run fetch:fonts`, `pip install -r backend/requirements-build.txt` inside `backend/.venv` (PyInstaller), FFmpeg on PATH, and `npm run mock:video` for the sample project.

What `dist` does:

1. `npm run build` — the web UI and Electron main/preload.
2. `npm run build:backend` — freezes the Python backend with PyInstaller (`backend/clipforge-backend.spec` → `backend/dist/clipforge-backend`), so users don't need Python.
3. `scripts/copy-ffmpeg.mjs` — copies the FFmpeg on PATH (and its license) into `build/ffmpeg`.
4. `electron-builder --win` — packs everything into an NSIS installer (`electron-builder.yml`). The backend, FFmpeg and caption fonts ship as resources next to the app.

In the installed app:

- **Settings** (Projects screen or File menu) stores the **Claude API key** in the app data folder's `.env` and shows the data folder.
- **GPU acceleration** isn't bundled: NVIDIA's CUDA libraries are ~2 GB and NSIS installers can't exceed 2 GB. On machines with an NVIDIA GPU, **Settings → Enable GPU acceleration** downloads the same cuBLAS/cuDNN/NVRTC wheels from PyPI (~1.4 GB, once) into the app data folder. Until then transcription runs on the CPU (Whisper `small`).
- The Whisper and face-tracking models download on first use, as in development.
- Scoring weights can be tuned by copying `scoring_weights.toml` into the app data folder.
- **Licensing**: the bundled FFmpeg is the gyan.dev *full* build, which is GPL-licensed (its license ships in `resources/ffmpeg`). That's fine for personal use; to distribute ClipForge, comply with the GPL or bundle an LGPL FFmpeg build instead.
- The macOS build (`electron-builder --mac`) has to run on a Mac, with a macOS PyInstaller build of the backend.

## Releases (GitHub Actions) and auto-updates

Releases are built by GitHub on its own Windows and Mac machines (`.github/workflows/release.yml`) and published at **github.com/Calepeb/clipforge/releases**:

1. Bump `"version"` in `package.json` (e.g. `0.3.0`) and commit.
2. Push a matching tag:

   ```bash
   git tag v0.3.0
   ```

   ```bash
   git push origin main v0.3.0
   ```

3. Watch progress in the repo's **Actions** tab (~20–40 minutes). Each machine installs Node, Python, FFmpeg (`ffmpeg-static`, checked for libass), the fonts and the backend, builds its installer and uploads it to a draft release; the last step publishes it.

You can also start a build from **Actions → Release → Run workflow** (it uses the version in `package.json`). No personal token is needed — the workflow uses GitHub's built-in one.

**Auto-updates (Windows)**: the installed app checks the latest release shortly after launch and every 6 hours. A notice appears on the Projects screen; **Settings → Updates** downloads it and **Restart to update** installs it after saving your projects.

**Mac**: the release includes `ClipForge-<version>-arm64.dmg` for Apple Silicon Macs (M1 and newer). It isn't signed with an Apple Developer certificate ($99/year), so:

- the first time, open it with **right-click → Open** (or *System Settings → Privacy & Security → Open Anyway*); if macOS says it's "damaged", run `xattr -cr /Applications/ClipForge.app` in Terminal;
- it doesn't auto-update — download new versions from the releases page;
- transcription runs on the CPU and exports use Apple's VideoToolbox hardware encoder.

## Troubleshooting

- **Automated tests**: `CLIPFORGE_HIDE_WINDOW=1` keeps the Electron window hidden (used with `REMOTE_DEBUGGING_PORT` for scripted end-to-end tests).

- **Backend logs:** `%APPDATA%\ClipForge\logs\backend.log` on Windows, `~/Library/Application Support/ClipForge/logs/backend.log` on macOS. The terminal running `npm run dev` shows the same lines prefixed with `[backend]`.
- **"The Python backend is not set up"**: run `npm run setup:backend` and restart the app.
- **Transcription runs on the CPU although you have an NVIDIA GPU**: re-run `npm run setup:backend` (installs cuBLAS/cuDNN); the log says why the GPU was skipped. Force a device with `WHISPER_DEVICE=cpu` in `.env`.
- **Audio energy skipped**: FFmpeg must be on PATH.

