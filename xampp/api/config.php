<?php
declare(strict_types=1);

function sukatEnvironment(string $name, string $fallback): string
{
    $value = getenv($name);
    return is_string($value) && $value !== '' ? $value : $fallback;
}

return [
    'db_host' => sukatEnvironment('SUKATAI_DB_HOST', '127.0.0.1'),
    'db_port' => sukatEnvironment('SUKATAI_DB_PORT', '3306'),
    'db_name' => sukatEnvironment('SUKATAI_DB_NAME', 'sukatai'),
    'db_user' => sukatEnvironment('SUKATAI_DB_USER', 'root'),
    'db_pass' => sukatEnvironment('SUKATAI_DB_PASS', ''),
    'storage_dir' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage',
];
