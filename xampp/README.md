# SukatAI on XAMPP

This folder adds a local PHP/MySQL fallback runtime for the app. The requested Node.js + MariaDB + Socket.IO runtime is documented in the root README; XAMPP can still provide the local MariaDB server for it. Supabase remains available as the default hosted runtime.

## One-time setup

1. Start Apache and MySQL in the XAMPP Control Panel.
2. Open http://localhost/phpmyadmin/, then import xampp/database/sukatai.sql.
3. If your MySQL root account has a password, edit xampp/api/config.php or provide SUKATAI_DB_PASS to Apache/PHP.

## Build and deploy

From the project folder:

~~~powershell
npm install
npm run build:xampp
.\xampp\install-xampp.ps1
~~~

Open http://localhost/bsit-sukat-ai/.

The deployment script copies the Vite build, PHP API, Apache SPA fallback, and private upload rules into C:\xampp\htdocs\bsit-sukat-ai. It does not delete other XAMPP files.

## First account and admin access

Create a customer account through the app. To enable the admin console for that account, run this in phpMyAdmin:

~~~sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
~~~

Sign out and sign in again after changing the role.

## Development against XAMPP

To use the Vite development server with the XAMPP PHP API, create .env.xampp.local in the project root:

~~~dotenv
VITE_XAMPP_API_URL=http://127.0.0.1/bsit-sukat-ai/api/index.php
~~~

Then run:

~~~powershell
npm run dev:xampp
~~~

For the normal XAMPP deployment, no extra environment file is needed because the API URL is resolved relative to the installed app directory.

The XAMPP `process_scan` action uses the same deterministic local demo result and the `public/media/3d-body-scan-reference-v3.png` reference visual as local Supabase development. It does not call an external Imagen or reconstruction provider, and the procedural result is not a personalized scan.
