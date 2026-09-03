from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import os
from pathlib import Path
import platform
import sys
from typing import Any


SERVICE_ROOT = Path(__file__).resolve().parents[2]


def _path_from_env(name: str, default: Path) -> Path:
    value = os.getenv(name, "").strip()
    return Path(value).expanduser() if value else default


@dataclass(frozen=True)
class Settings:
    ai_mode: str
    device: str
    reconstruction_backend: str
    smplx_model_dir: Path
    pixie_model_dir: Path
    anthropometry_dir: Path
    output_dir: Path
    max_upload_bytes: int
    max_image_long_edge: int
    max_concurrent_scans: int
    anny_max_iterations: int
    anny_early_stop_delta: float
    pose_landmarker_model_path: Path
    api_key: str | None
    allowed_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        raw_origins = os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
        origins = tuple(origin.strip() for origin in raw_origins.split(",") if origin.strip())
        return cls(
            ai_mode=os.getenv("SUKATAI_AI_MODE", "low_end").strip().lower() or "low_end",
            # SukatAI's supported production target is an Intel integrated-GPU
            # laptop. Never auto-select CUDA simply because it happens to be
            # installed on a development machine.
            device="cpu",
            reconstruction_backend=os.getenv("RECONSTRUCTION_BACKEND", "anny_clad").strip().lower() or "anny_clad",
            smplx_model_dir=_path_from_env("SMPLX_MODEL_DIR", SERVICE_ROOT / "models" / "smplx"),
            pixie_model_dir=_path_from_env("PIXIE_MODEL_DIR", SERVICE_ROOT / "models" / "pixie"),
            anthropometry_dir=_path_from_env("ANTHROPOMETRY_DIR", SERVICE_ROOT / "vendor" / "SMPL-Anthropometry"),
            output_dir=_path_from_env("OUTPUT_DIR", SERVICE_ROOT / "output"),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
            max_image_long_edge=int(os.getenv("MAX_IMAGE_LONG_EDGE", "1280")),
            max_concurrent_scans=int(os.getenv("MAX_CONCURRENT_SCANS", "1")),
            anny_max_iterations=int(os.getenv("ANNY_MAX_ITERATIONS", "60")),
            anny_early_stop_delta=float(os.getenv("ANNY_EARLY_STOP_DELTA", "0.002")),
            pose_landmarker_model_path=_path_from_env(
                "POSE_LANDMARKER_MODEL_PATH", SERVICE_ROOT / "models" / "pose_landmarker_lite.task"
            ),
            api_key=os.getenv("AI_SERVICE_API_KEY", "").strip() or None,
            allowed_origins=origins,
        )

    def resolved_device(self) -> str:
        return "cpu"


def _has_model_file(directory: Path, suffixes: tuple[str, ...]) -> bool:
    if not directory.is_dir():
        return False
    return any(path.is_file() and path.suffix.lower() in suffixes for path in directory.rglob("*"))


def model_asset_status(settings: Settings | None = None, *, include_paths: bool = True) -> dict[str, Any]:
    current = settings or Settings.from_env()
    smplx_ready = _has_model_file(current.smplx_model_dir, (".pkl", ".npz"))
    pixie_ready = _has_model_file(current.pixie_model_dir, (".pth", ".pt", ".pkl", ".tar"))
    anthropometry_ready = current.anthropometry_dir.is_dir() and any(current.anthropometry_dir.iterdir())
    try:
        import torch  # type: ignore

        torch_version = torch.__version__
        cuda_available = bool(torch.cuda.is_available())
        cuda_version = getattr(getattr(torch, "version", None), "cuda", None)
        gpu_name = torch.cuda.get_device_name(0) if cuda_available else None
    except ImportError:
        torch_version = None
        cuda_available = False
        cuda_version = None
        gpu_name = None
    assets = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "device": current.resolved_device(),
        "configured_backend": current.reconstruction_backend,
        "ai_mode": current.ai_mode,
        "pose_landmarker": {"ready": current.pose_landmarker_model_path.is_file()},
        "torch_version": torch_version,
        "cuda_available": cuda_available,
        "cuda_version": cuda_version,
        "gpu": gpu_name,
        "smplx": {"ready": smplx_ready, "path": str(current.smplx_model_dir)},
        "pixie": {"ready": pixie_ready, "path": str(current.pixie_model_dir)},
        "anthropometry": {"ready": anthropometry_ready, "path": str(current.anthropometry_dir)},
        "inference_ready": current.pose_landmarker_model_path.is_file(),
    }
    if not include_paths:
        for name in ("smplx", "pixie", "anthropometry"):
            if isinstance(assets.get(name), dict):
                assets[name].pop("path", None)
    return assets


def optional_dependency_status() -> dict[str, bool]:
    return {
        name: importlib.util.find_spec(name) is not None
        for name in (
            "fastapi", "PIL", "numpy", "trimesh", "cv2", "torch", "scipy", "mediapipe", "anny", "clad_body"
        )
    }
