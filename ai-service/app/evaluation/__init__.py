"""Internal, read-only evaluation of provider results against tape references.

This package exists for TRUTH-04: it compares a provider result with consented
tape-measurement references and reports per-measurement error. It is deliberately
pure and read-only — it never writes production customer values and is clearly
not a customer-facing accuracy claim.
"""
