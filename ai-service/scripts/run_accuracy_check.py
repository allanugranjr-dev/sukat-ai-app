from __future__ import annotations

import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.core.config import Settings
from app.pipeline import BodyScanPipeline


def main() -> int:
    front_path = SERVICE_ROOT.parent / "docs" / "fit-validation" / "front-v1.png"
    side_path = SERVICE_ROOT.parent / "docs" / "fit-validation" / "side-v1.png"

    if not front_path.is_file():
        print(f"ERROR: Front image not found: {front_path}", file=sys.stderr)
        return 2
    if not side_path.is_file():
        print(f"ERROR: Side image not found: {side_path}", file=sys.stderr)
        return 2

    print(f"Front image: {front_path}")
    print(f"Side image:  {side_path}")
    print("Height:      170 cm (default reference)")
    print("-" * 60)

    settings = Settings.from_env()
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    pipeline = BodyScanPipeline(settings)

    images = {
        "front": front_path.read_bytes(),
        "side": side_path.read_bytes(),
    }

    try:
        result = pipeline.process("accuracy-check-001", images, 170.0)
    except Exception as error:
        print(f"\nPIPELINE FAILED: {error}", file=sys.stderr)
        return 1

    print(f"\nStatus:   {result.status.value}")
    print(f"Quality:  {result.scan_quality.value}")
    print(f"Version:  {result.processing_version}")
    model_fmt = result.model.format if result.model else "none"
    model_sz = result.model.size_bytes if result.model else 0
    print(f"Model:    {model_fmt} ({model_sz} bytes)")

    if result.quality_issues:
        print(f"\nQuality Issues ({len(result.quality_issues)}):")
        for issue in result.quality_issues:
            view_tag = f"[{issue.view}]" if issue.view else ""
            print(f"  {issue.severity.upper()} {view_tag} {issue.code}: {issue.message}")

    print(f"\nMeasurements ({len(result.measurements)}):")
    print(f"{'Key':<30} {'Value':>8} {'Unit':<4} {'Method':<15} Source")
    print("-" * 90)
    for m in result.measurements:
        print(f"{m.key:<30} {m.value:>8.2f} {m.unit:<4} {m.method.value:<15} {m.source}")

    if result.reconstruction:
        r = result.reconstruction
        print("\nReconstruction Metadata:")
        print(f"  Backend:          {r.backend}")
        print(f"  Device:           {r.device}")
        print(f"  Scale Factor:     {r.scale_factor:.6f}")
        print(f"  Mesh Height:      {r.mesh_height_cm_before_calibration:.2f} cm (before cal)")
        print(f"  Calibrated Ht:    {r.calibrated_height_cm:.2f} cm")
        if r.guide_fractions:
            print(f"  Guide Fractions:  {json.dumps(r.guide_fractions, indent=4)}")

    output_json = settings.output_dir / "accuracy-check-001-result.json"
    output_json.write_text(json.dumps(result.model_dump(mode="json"), indent=2), encoding="utf-8")
    print(f"\nFull result saved to: {output_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
