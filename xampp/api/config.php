<?php
declare(strict_types=1);

function sukatEnvironment(string $name, string $fallback): string
{
    $value = getenv($name);
    return is_string($value) && $value !== '' ? $value : $fallback;
}

return [
    'public_app_url' => rtrim(sukatEnvironment('SUKATAI_PUBLIC_APP_URL', 'http://127.0.0.1:5173'), '/'),
    // The reference-result path is retained only for UI demos. Real scans
    // must use the Node gateway and the CPU Anny + CLAD provider.
    'allow_demo' => in_array(strtolower(sukatEnvironment('SUKATAI_ALLOW_DEMO', 'false')), ['1', 'true', 'yes', 'on'], true),
    'db_host' => sukatEnvironment('SUKATAI_DB_HOST', '127.0.0.1'),
    'db_port' => sukatEnvironment('SUKATAI_DB_PORT', '3306'),
    'db_name' => sukatEnvironment('SUKATAI_DB_NAME', 'sukatai'),
    'db_user' => sukatEnvironment('SUKATAI_DB_USER', 'root'),
    'db_pass' => sukatEnvironment('SUKATAI_DB_PASS', ''),
    'storage_dir' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage',
    'smtp' => [
        'host' => sukatEnvironment('SUKATAI_SMTP_HOST', ''),
        'port' => sukatEnvironment('SUKATAI_SMTP_PORT', '587'),
        'user' => sukatEnvironment('SUKATAI_SMTP_USER', ''),
        'pass' => sukatEnvironment('SUKATAI_SMTP_PASS', ''),
        'from' => sukatEnvironment('SUKATAI_SMTP_FROM', ''),
        'secure' => sukatEnvironment('SUKATAI_SMTP_SECURE', 'tls'),
    ],
    'is_production' => (strtolower(sukatEnvironment('SUKATAI_ENV', sukatEnvironment('APP_ENV', 'development'))) === 'production'),
];
