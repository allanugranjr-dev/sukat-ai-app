# Body-model fit validation references

These generated references are visual QA fixtures for the interactive measured model. They keep the same subject, suit, lighting, framing, and guide language across three views:

- `front-v1.png` — front orthographic reference
- `side-v1.png` — side orthographic reference
- `three-quarter-v1.png` — front-left three-quarter reference

The default comparison set is 170 cm with these returned values: chest 100.1 cm, waist 82.2 cm, hip 94.8 cm, neck 37.6 cm, head 59.7 cm, shoulder 52.5 cm, bicep 33.3 cm, forearm 28.0 cm, wrist 17.5 cm, thigh 55.3 cm, calf 36.4 cm, ankle 24.3 cm, inseam 72.4 cm, arm length 57.3 cm, neck-to-pelvis 68.6 cm, back-to-shoulder 21.2 cm, foot length 26.2 cm, and foot width 9.7 cm.

The images are visual references, not scan-grade ground truth. Numeric fit is validated in code: circumference values round-trip through the ellipse solver, length guides use the returned endpoints, and side-specific values remain isolated when present. A true scan-grade result still requires a calibrated reconstruction provider or a real GLB mesh.
