# PyInstaller spec for the frozen backend shipped in the installer.
# Build: .venv\Scripts\python -m PyInstaller clipforge-backend.spec --noconfirm
# Output: dist/clipforge-backend/clipforge-backend.exe (one-folder build).
#
# NVIDIA CUDA libraries are excluded on purpose (~2 GB, over the NSIS installer limit);
# the app downloads them on demand (Settings → Enable GPU acceleration, see clipforge/gpu.py).
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [("clipforge/analysis/scoring_weights.toml", "clipforge/analysis")], [], []
for pkg in ("faster_whisper", "ctranslate2", "onnxruntime", "av", "mediapipe", "cv2", "scenedetect", "tokenizers", "fontTools"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h
hiddenimports += collect_submodules("uvicorn") + collect_submodules("clipforge") + ["anthropic", "dotenv", "huggingface_hub"]

a = Analysis(
    ["run_backend.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["nvidia", "tkinter", "torch", "IPython", "pytest"],  # (mediapipe needs matplotlib)
    noarchive=False,
)
# Belt and braces: drop any CUDA DLLs a hook pulled in anyway.
a.binaries = [b for b in a.binaries if not b[0].replace("\\", "/").lower().startswith("nvidia/")]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="clipforge-backend", console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="clipforge-backend")
