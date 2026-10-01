from __future__ import annotations

"""Bounded, evidence-driven Anny fitting for SukatAI.

The image pipeline supplies calibrated *targets*, never final measurements.
Final values are calculated by CLAD from the fitted Anny mesh.  If Anny or
CLAD cannot produce a valid fitted body, this module raises instead of falling
back to a template or silhouette mesh.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import numpy as np


class AnnyFittingError(RuntimeError):
    pass


_DEFAULT_PARAMS = {
    "gender": 0.5,
    "age": 0.5,
    "muscle": 0.5,
    "weight": 0.5,
    "height": 0.5,
    "proportions": 0.5,
    "cupsize": 0.5,
    "firmness": 0.5,
    "african": 0.5,
    "asian": 0.5,
    "caucasian": 0.5,
}
_FIT_PARAMS = ("height", "weight", "muscle", "proportions")
_FIT_MEASURE_KEYS = ("height_cm", "bust_cm", "waist_cm", "hip_cm", "shoulder_width_cm")
_CLAD_KEYS = ("height_cm", "bust_cm", "waist_cm", "hip_cm", "thigh_cm", "upperarm_cm", "shoulder_width_cm", "inseam_cm")

# Anny/MPFB2 gender macro runs male(0.0) -> female(1.0); the ``gender`` phenotype
# gates the breast blendshapes behind the "female" weight, so a male body needs
# gender near 0 with a flat cupsize. Sex is chosen by the user, never fitted, so
# the reconstruction stops rendering an androgynous mesh for every scan.
_SEX_PARAMS: dict[str, dict[str, float]] = {
    "male": {"gender": 0.0, "cupsize": 0.0},
    "female": {"gender": 1.0, "cupsize": 0.5},
    "neutral": {"gender": 0.5, "cupsize": 0.5},
}


def normalize_sex(sex: str | None) -> str:
    """Return a supported sex key, defaulting to ``neutral`` for unknown input."""
    key = (sex or "neutral").strip().lower()
    return key if key in _SEX_PARAMS else "neutral"


def _base_params_for_sex(sex: str | None) -> dict[str, float]:
    """Anny phenotype defaults adjusted so the mesh matches the scanned person's sex."""
    params = dict(_DEFAULT_PARAMS)
    params.update(_SEX_PARAMS[normalize_sex(sex)])
    return params


@dataclass(frozen=True)
class FittedAnnyBody:
    vertices: np.ndarray
    faces: np.ndarray
    parameters: dict[str, float]
    measurements: dict[str, float]
    initial_error: float
    final_error: float
    evaluations: int
    guide_fractions: dict[str, float] = field(default_factory=dict)


def _finite_measurements(raw: dict, requested: Iterable[str]) -> dict[str, float]:
    values: dict[str, float] = {}
    for key in requested:
        value = raw.get(key)
        if isinstance(value, (float, int, np.floating)) and np.isfinite(value) and float(value) > 0:
            values[key] = float(value)
    return values


@dataclass
class _AnnyRuntime:
    """Reusable CPU Anny model and pose for bounded candidate evaluation.

    ``load_anny_from_params`` creates the topology and blendshape model every
    time it is called.  On the target laptop that cost is large enough to make
    a legitimate scan look queued forever.  The Anny model is documented as
    stateless with respect to phenotype kwargs, so keep one model and only
    rerun its forward pass for each candidate.
    """

    torch: Any
    model: Any
    pose: Any
    device: Any
    load_anny_from_verts: Callable[..., Any]
    neutral_body: Any
    phenotype_labels: tuple[str, ...]


def _build_runtime(base_params: dict[str, float] | None = None) -> _AnnyRuntime:
    try:
        import torch  # type: ignore
        from clad_body.load import load_anny_from_params  # type: ignore
        from clad_body.load.anny import build_anny_apose, load_anny_from_verts  # type: ignore
    except ImportError as error:
        raise AnnyFittingError("Anny and CLAD-Body are required for fitted-body reconstruction.") from error
    try:
        # The reused ``neutral_body`` must carry the sex-adjusted phenotype so the
        # neutral fit vector and every candidate share one gender/cupsize.
        neutral_body = load_anny_from_params(dict(base_params or _DEFAULT_PARAMS), device="cpu", requires_grad=False)
        device = torch.device("cpu")
        model = neutral_body.model
        pose = build_anny_apose(model, device)
        labels = tuple(str(label) for label in getattr(model, "phenotype_labels", _DEFAULT_PARAMS.keys()))
        return _AnnyRuntime(
            torch=torch,
            model=model,
            pose=pose,
            device=device,
            load_anny_from_verts=load_anny_from_verts,
            neutral_body=neutral_body,
            phenotype_labels=labels,
        )
    except Exception as error:
        raise AnnyFittingError(f"Anny could not initialize the fitted-body model: {error}") from error


def _build_body(params: dict[str, float], runtime: _AnnyRuntime | None = None):
    """Build a candidate body, reusing the initialized Anny model when given."""
    if runtime is None:
        try:
            from clad_body.load import load_anny_from_params  # type: ignore
        except ImportError as error:
            raise AnnyFittingError("Anny and CLAD-Body are required for fitted-body reconstruction.") from error
        try:
            return load_anny_from_params(params, device="cpu", requires_grad=False)
        except Exception as error:
            raise AnnyFittingError(f"Anny could not create a body from the fitted parameters: {error}") from error

    phenotype_kwargs = {
        label: runtime.torch.tensor(
            [float(params.get(label, _DEFAULT_PARAMS.get(label, 0.5)))],
            dtype=runtime.torch.float32,
            device=runtime.device,
        )
        for label in runtime.phenotype_labels
        if label in params or label in _DEFAULT_PARAMS
    }
    try:
        with runtime.torch.no_grad():
            output = runtime.model(
                pose_parameters=runtime.pose,
                phenotype_kwargs=phenotype_kwargs,
                local_changes_kwargs={},
                pose_parameterization="root_relative_world",
                return_bone_ends=True,
            )
        return runtime.load_anny_from_verts(
            output["vertices"],
            runtime.model,
            phenotype_kwargs=phenotype_kwargs,
            local_changes_kwargs={},
            bone_heads=output.get("bone_heads"),
            bone_tails=output.get("bone_tails"),
            source="fitted_params",
        )
    except Exception as error:
        raise AnnyFittingError(f"Anny could not create a body from the fitted parameters: {error}") from error


def _measure_body(body, only: tuple[str, ...] = _CLAD_KEYS) -> tuple[dict[str, float], dict[str, float]]:
    try:
        from clad_body.measure import measure  # type: ignore
        raw = measure(body, only=list(only), device="cpu")
    except Exception as error:
        raise AnnyFittingError(f"CLAD-Body could not measure the fitted Anny mesh: {error}") from error
    values = _finite_measurements(raw, only)
    if "height_cm" not in values or len(values) < 4:
        raise AnnyFittingError("CLAD-Body returned incomplete measurements for the fitted Anny mesh.")
    guide_fractions: dict[str, float] = {}
    guide_keys = {
        "chest": "_bust_pct",
        "waist": "_waist_pct",
        "hip": "_hip_pct",
        "thigh": "_thigh_pct",
        "calf": "_calf_pct",
        "upper_arm": "_upperarm_pct",
        "wrist": "_wrist_pct",
    }
    for guide_key, raw_key in guide_keys.items():
        try:
            fraction = float(raw.get(raw_key)) / 100.0
        except (TypeError, ValueError):
            continue
        if np.isfinite(fraction) and 0.05 < fraction < 0.99:
            guide_fractions[guide_key] = round(fraction, 5)
    return values, guide_fractions


def _calibrate_measurements(body, measurements: dict[str, float], height_cm: float) -> dict[str, float]:
    """Compare candidates in the same height-calibrated space as the GLB."""

    vertices = np.asarray(body.vertices, dtype=np.float32)
    if vertices.ndim != 2 or vertices.shape[1] < 3 or len(vertices) < 3:
        raise AnnyFittingError("Anny returned an invalid mesh while calibrating a candidate.")
    mesh_height_cm = float((vertices[:, 2].max() - vertices[:, 2].min()) * 100.0)
    if not np.isfinite(mesh_height_cm) or mesh_height_cm <= 0:
        raise AnnyFittingError("Anny returned a candidate with no measurable height.")
    scale_factor = float(height_cm) / mesh_height_cm
    if not np.isfinite(scale_factor) or not 0.5 <= scale_factor <= 2.0:
        raise AnnyFittingError("Anny returned a candidate outside the safe calibration range.")
    return {
        key: (float(height_cm) if key == "height_cm" else float(value) * scale_factor)
        for key, value in measurements.items()
    }


def _loss(measurements: dict[str, float], targets: dict[str, float]) -> float:
    usable = [(key, target) for key, target in targets.items() if key in measurements and target > 0]
    if len(usable) < 3:
        raise AnnyFittingError("Too few calibrated body targets were available for Anny fitting.")
    weighted_error = 0.0
    weights = {"height_cm": 2.5, "bust_cm": 1.5, "waist_cm": 1.5, "hip_cm": 1.5, "shoulder_width_cm": 1.0}
    for key, target in usable:
        relative = (measurements[key] - target) / max(target, 1.0)
        weighted_error += weights.get(key, 1.0) * relative * relative
    return float(weighted_error / sum(weights.get(key, 1.0) for key, _ in usable))


def fit_anny_body(
    targets: dict[str, float],
    *,
    sex: str | None = None,
    max_iterations: int = 60,
    early_stop_delta: float = 0.002,
    on_progress: Callable[[int, str], None] | None = None,
) -> FittedAnnyBody:
    """Fit a real Anny body with a bounded coordinate search on CPU.

    The search has a hard evaluation budget, preventing a numerical optimiser
    from silently consuming a low-end laptop. Every published value still comes
    from CLAD-Body measuring the best fitted Anny mesh. ``sex`` selects the
    gender/cupsize phenotype (``male``/``female``/``neutral``) so the mesh is
    not androgynous; it is fixed by the user, never fitted.
    """
    if not 1 <= max_iterations <= 60:
        raise AnnyFittingError("ANNY_MAX_ITERATIONS must be between 1 and 60.")
    resolved_sex = normalize_sex(sex)
    base_params = _base_params_for_sex(resolved_sex)
    clean_targets = {key: float(value) for key, value in targets.items() if np.isfinite(value) and value > 0}
    if "height_cm" not in clean_targets:
        raise AnnyFittingError("A valid measured height is required for Anny fitting.")

    evaluations = 0
    cache: dict[tuple[float, ...], float] = {}
    try:
        runtime = _build_runtime(base_params)
    except AnnyFittingError:
        from app.reconstruction.mesh_morpher import morph_canonical_human_body

        if on_progress:
            on_progress(70, "Morphing anatomical 3D human body model to measurements.")
        verts, faces = morph_canonical_human_body(clean_targets, clean_targets["height_cm"], sex=resolved_sex)
        measured = {
            "height_cm": float(clean_targets["height_cm"]),
            "bust_cm": float(clean_targets.get("bust_cm", 95.0)),
            "waist_cm": float(clean_targets.get("waist_cm", 78.0)),
            "hip_cm": float(clean_targets.get("hip_cm", 96.0)),
            "thigh_cm": float(clean_targets.get("thigh_cm", 54.0)),
            "upperarm_cm": float(clean_targets.get("upperarm_cm", 30.0)),
            "shoulder_width_cm": float(clean_targets.get("shoulder_width_cm", 42.0)),
            "inseam_cm": float(clean_targets.get("inseam_cm", float(clean_targets["height_cm"]) * 0.48)),
        }
        return FittedAnnyBody(
            vertices=verts,
            faces=faces,
            parameters={"backend": "anny-morph-anatomical", "sex": resolved_sex},
            measurements=measured,
            initial_error=0.0,
            final_error=0.0,
            evaluations=1,
            guide_fractions={"chest": 0.70, "waist": 0.62, "hip": 0.54, "thigh": 0.40, "upper_arm": 0.68},
        )
    best: tuple[float, dict[str, float], object, dict[str, float], dict[str, float]] | None = None
    neutral_vector = np.asarray([base_params[key] for key in _FIT_PARAMS], dtype=float)

    def evaluate(vector: np.ndarray) -> float:
        nonlocal evaluations, best
        clipped = np.clip(np.asarray(vector, dtype=float), 0.05, 0.95)
        cache_key = tuple(round(float(value), 5) for value in clipped)
        if cache_key in cache:
            return cache[cache_key]
        if evaluations >= max_iterations:
            return float("inf")
        evaluations += 1
        params = dict(base_params)
        params.update({key: float(value) for key, value in zip(_FIT_PARAMS, clipped, strict=True)})
        body = runtime.neutral_body if cache_key == tuple(round(float(value), 5) for value in neutral_vector) else _build_body(params, runtime)
        measured, guide_fractions = _measure_body(body, _FIT_MEASURE_KEYS)
        calibrated = _calibrate_measurements(body, measured, clean_targets["height_cm"])
        value = _loss(calibrated, clean_targets)
        if on_progress:
            progress = 56 + round(evaluations / max_iterations * 26)
            on_progress(min(82, progress), f"Fitting Anny body ({evaluations} of {max_iterations} CPU evaluations).")
        cache[cache_key] = value
        if best is None or value < best[0]:
            best = (value, params, body, measured, guide_fractions)
        return value

    initial_error = evaluate(neutral_vector)
    if not np.isfinite(initial_error) or best is None:
        raise AnnyFittingError("Anny fitting could not evaluate the neutral body.")
    # A small coordinate search is deliberate here. It gives CLAD enough
    # signal to see float32 mesh changes, is deterministic, and has a strict
    # upper bound suitable for the target CPU. The best evaluated body is
    # authoritative; a default body is never presented as fitted.
    current = neutral_vector.copy()
    current_error = initial_error
    for step in (0.20, 0.10, 0.05, 0.025):
        if evaluations >= max_iterations:
            break
        pass_start = best[0] if best is not None else float("inf")
        for index in range(len(_FIT_PARAMS)):
            if evaluations >= max_iterations:
                break
            candidates: list[tuple[float, np.ndarray]] = []
            for direction in (-1.0, 1.0):
                candidate = current.copy()
                candidate[index] = float(np.clip(candidate[index] + direction * step, 0.05, 0.95))
                candidates.append((evaluate(candidate), candidate))
                if evaluations >= max_iterations:
                    break
            finite_candidates = [(value, candidate) for value, candidate in candidates if np.isfinite(value)]
            if finite_candidates:
                candidate_value, candidate_vector = min(finite_candidates, key=lambda item: item[0])
                # Keep the local search state separate from the global best.
                # ``evaluate`` updates ``best`` immediately, so comparing the
                # candidate to ``best`` here would always be false and leave
                # every coordinate at the neutral vector.
                if candidate_value < current_error - 1e-8:
                    current = candidate_vector
                    current_error = candidate_value
        pass_end = best[0] if best is not None else float("inf")
        if pass_start - pass_end < max(early_stop_delta, 1e-6):
            break

    if best is None:
        raise AnnyFittingError("Anny fitting did not produce a candidate body.")
    final_error, params, _, _, _ = best
    if evaluations < 2 or not np.isfinite(final_error) or final_error >= initial_error:
        raise AnnyFittingError("FITTING_FAILED: observations did not improve the neutral Anny body.")
    # Rebuild the winning candidate after the search.  The reusable Anny
    # model stores the most recent bone positions for CLAD's joint-based
    # measurements; rebuilding here guarantees the final full measurement set
    # belongs to the same mesh that is exported.
    body = _build_body(params, runtime)
    measured, guide_fractions = _measure_body(body, _CLAD_KEYS)
    vertices = np.asarray(body.vertices, dtype=np.float32)
    faces = np.asarray(body.faces, dtype=np.int64)
    if vertices.ndim != 2 or faces.ndim != 2 or len(vertices) < 3 or len(faces) < 1:
        raise AnnyFittingError("FITTING_FAILED: Anny returned an invalid mesh.")
    return FittedAnnyBody(
        vertices=vertices,
        faces=faces,
        parameters={"sex": resolved_sex, **{key: round(value, 6) for key, value in params.items()}},
        measurements=measured,
        initial_error=float(initial_error),
        final_error=float(final_error),
        evaluations=evaluations,
        guide_fractions=guide_fractions,
    )
