# Model setup and licensing

The active lightweight pipeline uses the official MediaPipe Lite pose asset plus
the installed Anny and CLAD-Body packages. The pose asset is not committed to
Git; download it once with:

```powershell
python scripts/download_pose_model.py
```

The script downloads only the small pinned task file from Google's official
MediaPipe model host and enforces a 10 MB response limit.

## Optional learned reconstruction

The following legacy adapters are retained only as guarded compatibility
boundaries. They are not part of the active `anny_clad` path, and should not be
enabled without a separately licensed, tested runner:

Set the corresponding directories in `.env` or the deployment environment:

```ini
RECONSTRUCTION_BACKEND=pixie
PIXIE_MODEL_DIR=C:\path\to\licensed\pixie\models
SMPLX_MODEL_DIR=C:\path\to\licensed\smplx\models
ANTHROPOMETRY_DIR=C:\path\to\licensed\SMPL-Anthropometry
DEVICE=cpu
```

The current `PixieAdapter` and `SMPLXAdapter` are guarded adapters. A directory containing weights alone is not treated as a runnable model. A concrete image-to-parameter runner and compatible versions of the model libraries must be registered before `RECONSTRUCTION_BACKEND=pixie` can produce a learned result.

## Asset checklist

1. Confirm the model license permits the intended research or commercial use.
2. Download checkpoints through the official provider; do not commit them.
3. Verify the model/library version and expected input image convention.
4. Register the runner in the adapter without changing the API response contract.
5. Run `python scripts/system_check.py` and the full test suite.
6. Validate against consented reference scans before enabling the backend for users.

Keep `RECONSTRUCTION_BACKEND=anny_clad` for the active pipeline. If a legacy
adapter is selected without a verified runner, the service must fail rather
than publish a silhouette/template result as a personalized scan.
