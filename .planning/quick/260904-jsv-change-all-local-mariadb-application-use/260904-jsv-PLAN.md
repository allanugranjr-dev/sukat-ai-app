---
status: complete
---

# Change all local MariaDB application passwords

Update every row in the local MariaDB `users` table so `password_hash` is a
fresh bcrypt hash of the password supplied by the user. Do not store or print
the plaintext password, and do not modify Supabase Auth accounts or MariaDB
server accounts.

## Task

1. Connect to the configured `sukatai` MariaDB database, count the existing
   application users, update all `users.password_hash` values in one
   transaction, and verify each updated hash matches the supplied password
   without exposing the password or hash.

## Verification

- The transaction completes successfully and affects all existing application
  users.
- A bcrypt comparison succeeds for every updated row.
- No plaintext password is written to the database.
