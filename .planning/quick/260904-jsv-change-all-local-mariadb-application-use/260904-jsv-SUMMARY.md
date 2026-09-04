---
status: complete
---

# Change all local MariaDB application passwords

Updated all four rows in the configured local `sukatai.users` table. Each
`password_hash` now contains a fresh bcrypt hash using the application’s
existing cost factor, and stale password-reset token fields were cleared.

## Verification

- MariaDB transaction committed successfully.
- Updated rows: 4.
- Bcrypt verification passed for all 4 updated rows.
- The plaintext password and generated hashes were not printed or stored.
- Supabase Auth accounts and MariaDB server accounts were not changed.
