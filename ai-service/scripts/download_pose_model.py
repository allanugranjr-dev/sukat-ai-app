from __future__ import annotations

"""Download the small official MediaPipe Lite pose asset once.

The model is intentionally kept out of Git and is downloaded separately from
the Python package. This script refuses unexpectedly large responses so a
mistyped URL cannot consume the laptop's limited disk space.
"""

from pathlib import Path
import os
import tempfile
from urllib.request import Request, urlopen


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)
SERVICE_ROOT = Path(__file__).resolve().parents[1]
DESTINATION = SERVICE_ROOT / "models" / "pose_landmarker_lite.task"
MAX_BYTES = 10 * 1024 * 1024
MIN_BYTES = 1 * 1024 * 1024


def download() -> Path:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    request = Request(MODEL_URL, headers={"User-Agent": "SukatAI/1.0"})
    fd, temporary_name = tempfile.mkstemp(prefix="pose-landmarker-", suffix=".task", dir=DESTINATION.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    total = 0
    try:
        with urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise RuntimeError("The pose model response is larger than the 10 MB safety limit.")
                output.write(chunk)
        if total < MIN_BYTES:
            raise RuntimeError("The downloaded pose model is unexpectedly small.")
        os.replace(temporary, DESTINATION)
        return DESTINATION
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    print(f"Downloaded {download()} ({DESTINATION.stat().st_size:,} bytes).")
