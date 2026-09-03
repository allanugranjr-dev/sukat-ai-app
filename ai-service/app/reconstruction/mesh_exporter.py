from __future__ import annotations

from pathlib import Path
import re
from typing import Any

import numpy as np

from app.reconstruction.base import ReconstructionError


SAFE_SCAN_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def export_glb(vertices: np.ndarray, faces: np.ndarray, output_dir: Path, scan_id: str, vertical_axis: int = 2) -> dict[str, Any]:
    if not SAFE_SCAN_ID.fullmatch(scan_id):
        raise ReconstructionError("scan_id contains unsafe characters")
    if vertical_axis not in (1, 2):
        raise ReconstructionError("GLB export supports only Y-up or Z-up input meshes")
    try:
        import trimesh  # type: ignore
    except ImportError as error:
        raise ReconstructionError("trimesh is required to export a browser-compatible GLB.") from error
    output_root = Path(output_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    destination = (output_root / f"{scan_id}.glb").resolve()
    if destination.parent != output_root:
        raise ReconstructionError("model output path escaped the configured output directory")
    try:
        source_vertices = np.asarray(vertices, dtype=np.float32)
        # Anny emits Z-up coordinates. GLB assets are normalized to Y-up so
        # the browser viewer, camera framing, and measurement guides share one
        # coordinate system. Preserve Y-up inputs for compatible callers.
        glb_vertices = (
            np.column_stack((source_vertices[:, 0], source_vertices[:, 2], -source_vertices[:, 1]))
            if vertical_axis == 2
            else source_vertices
        )
        mesh = trimesh.Trimesh(
            vertices=glb_vertices,
            faces=np.asarray(faces, dtype=np.int64),
            process=False,
        )
        if mesh.is_empty or len(mesh.vertices) < 3 or len(mesh.faces) < 1:
            raise ReconstructionError("mesh is empty")
        mesh.export(str(destination), file_type="glb")
        if not destination.is_file() or destination.stat().st_size <= 0:
            raise ReconstructionError("GLB export did not create a non-empty file")
        reopened = trimesh.load(str(destination), force="mesh")
        if reopened.is_empty or len(reopened.vertices) < 3 or len(reopened.faces) < 1:
            raise ReconstructionError("GLB validation failed after export")
    except ReconstructionError:
        raise
    except Exception as error:
        raise ReconstructionError(f"GLB export failed: {error}") from error
    return {"path": destination, "format": "glb", "size_bytes": destination.stat().st_size}
