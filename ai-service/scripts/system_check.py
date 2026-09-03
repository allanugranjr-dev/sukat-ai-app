from __future__ import annotations

import json
import sys
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.core.config import Settings, model_asset_status, optional_dependency_status  # noqa: E402


def main() -> int:
    settings = Settings.from_env()
    report = {
        "service_root": str(SERVICE_ROOT),
        "settings": {
            "device": settings.resolved_device(),
            "configured_backend": settings.reconstruction_backend,
            "output_dir": str(settings.output_dir),
            "max_image_long_edge": settings.max_image_long_edge,
            "max_concurrent_scans": settings.max_concurrent_scans,
            "max_upload_bytes": settings.max_upload_bytes,
            "ai_mode": settings.ai_mode,
        },
        "assets": model_asset_status(settings),
        "optional_dependencies": optional_dependency_status(),
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    required = report["optional_dependencies"]
    return 0 if all(required.get(name, False) for name in ("PIL", "numpy", "trimesh")) else 2


if __name__ == "__main__":
    raise SystemExit(main())
