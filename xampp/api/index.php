<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

if (session_status() === PHP_SESSION_NONE) {
    session_name('sukatai_xampp');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && preg_match('/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i', $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
}
if ($origin !== '') {
    $requestOrigin = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $localOrigin = (bool) preg_match('/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i', $origin);
    if (strcasecmp($origin, $requestOrigin) !== 0 && !$localOrigin) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'message' => 'The request origin is not allowed.'], JSON_UNESCAPED_SLASHES);
        exit;
    }
}
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

class SukatApiException extends RuntimeException
{
    public int $status;

    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

function jsonResponse($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError(string $message, int $status = 400): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

function database(): PDO
{
    global $config;
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_port'],
        $config['db_name'],
    );
    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function requestData(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') return $_GET;
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') return [];
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) throw new SukatApiException('Request body must be valid JSON.', 400);
        return $decoded;
    }
    return $_POST;
}

function stringInput(array $data, string $key, ?string $default = null): ?string
{
    if (!array_key_exists($key, $data) || $data[$key] === null) return $default;
    return is_scalar($data[$key]) ? trim((string) $data[$key]) : $default;
}

function booleanInput($value): bool
{
    return $value === true || $value === 1 || $value === '1' || strtolower((string) $value) === 'true';
}

function normalizePhone(?string $value): ?string
{
    $phone = preg_replace('/[\s().-]/', '', trim($value ?? '')) ?? '';
    if ($phone === '') return null;
    if (!preg_match('/^\+[1-9]\d{7,14}$/', $phone)) throw new SukatApiException('Enter a phone number in international format, for example +639171234567.', 400);
    return $phone;
}

function uuid(): string
{
    $hex = bin2hex(random_bytes(16));
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-a' . substr($hex, 16, 3) . '-' . substr($hex, 19, 12);
}

function mysqlDateTime(?string $value): ?string
{
    if ($value === null || $value === '') return null;
    $timestamp = strtotime($value);
    if ($timestamp === false) throw new SukatApiException('The supplied date is invalid.', 400);
    return gmdate('Y-m-d H:i:s', $timestamp);
}

function jsonValue($value): array
{
    if (is_array($value)) return $value;
    if (!is_string($value) || $value === '') return [];
    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function currentUser(): ?array
{
    static $loaded = false;
    static $user = null;
    if ($loaded) return $user;
    $loaded = true;
    $id = $_SESSION['user_id'] ?? '';
    if (!is_string($id) || $id === '') return null;
    $statement = database()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $statement->execute([$id]);
    $user = $statement->fetch() ?: null;
    if (!$user) unset($_SESSION['user_id']);
    return $user;
}

function requireUser(): array
{
    $user = currentUser();
    if (!$user) throw new SukatApiException('Sign in is required for this action.', 401);
    return $user;
}

function publicUser(array $user): array
{
    $created = (string) ($user['created_at'] ?? gmdate('Y-m-d H:i:s'));
    $updated = (string) ($user['updated_at'] ?? $created);
    return [
        'id' => $user['id'],
        'aud' => 'authenticated',
        'role' => 'authenticated',
        'email' => $user['email'],
        'email_confirmed_at' => $created,
        'phone' => $user['phone'] ?? '',
        'confirmed_at' => $created,
        'last_sign_in_at' => $updated,
        'app_metadata' => ['provider' => 'email', 'providers' => ['email']],
        'user_metadata' => [
            'first_name' => $user['first_name'],
            'last_name' => $user['last_name'],
        ],
        'identities' => [],
        'created_at' => $created,
        'updated_at' => $updated,
    ];
}

function sessionPayload(array $user): array
{
    $token = 'xampp-session';
    return [
        'access_token' => $token,
        'token_type' => 'bearer',
        'expires_in' => 86400,
        'expires_at' => time() + 86400,
        'refresh_token' => $token,
        'user' => publicUser($user),
    ];
}

function profileResponse(array $user): array
{
    return [
        'id' => $user['id'],
        'role' => $user['role'],
        'organization_id' => $user['organization_id'],
        'first_name' => $user['first_name'],
        'last_name' => $user['last_name'],
        'email' => $user['email'],
        'phone' => $user['phone'] ?? null,
        'email_notifications' => array_key_exists('email_notifications', $user) ? booleanInput($user['email_notifications']) : true,
        'sms_notifications' => array_key_exists('sms_notifications', $user) ? booleanInput($user['sms_notifications']) : false,
        'avatar_url' => $user['avatar_url'],
        'unit_system' => $user['unit_system'],
        'created_at' => $user['created_at'],
        'updated_at' => $user['updated_at'],
    ];
}

function organizationResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'owner_id' => $row['owner_id'],
        'settings' => jsonValue($row['settings'] ?? null),
        'created_at' => $row['created_at'],
    ];
}

function scanResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'customer_id' => $row['customer_id'],
        'organization_id' => $row['organization_id'],
        'status' => $row['status'],
        'height_value' => $row['height_value'] === null ? null : (float) $row['height_value'],
        'height_unit' => $row['height_unit'],
        'consent_at' => $row['consent_at'],
        'capture_source' => $row['capture_source'],
        'processing_provider' => $row['processing_provider'],
        'processing_version' => $row['processing_version'],
        'failure_reason' => $row['failure_reason'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}

function assetResponse(array $row, ?string $signedUrl = null): array
{
    $result = [
        'id' => $row['id'],
        'scan_id' => $row['scan_id'],
        'asset_type' => $row['asset_type'],
        'storage_path' => $row['storage_path'],
        'metadata' => jsonValue($row['metadata'] ?? null),
        'quality_status' => $row['quality_status'],
        'created_at' => $row['created_at'],
    ];
    if ($signedUrl !== null) $result['signedUrl'] = $signedUrl;
    return $result;
}

function bodyModelResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'scan_id' => $row['scan_id'],
        'provider' => $row['provider'],
        'model_url_or_path' => $row['model_url_or_path'],
        'preview_data' => jsonValue($row['preview_data'] ?? null),
        'status' => $row['status'],
        'created_at' => $row['created_at'],
    ];
}

function measurementResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'scan_id' => $row['scan_id'],
        'key' => $row['key'],
        'value' => (float) $row['value'],
        'unit' => $row['unit'],
        'confidence' => $row['confidence'] === null ? null : (float) $row['confidence'],
        'ai_value' => $row['ai_value'] === null ? null : (float) $row['ai_value'],
        'adjusted_value' => $row['adjusted_value'] === null ? null : (float) $row['adjusted_value'],
        'adjusted_by' => $row['adjusted_by'],
        'adjustment_reason' => $row['adjustment_reason'],
        'verified_at' => $row['verified_at'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}

function orderResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'customer_id' => $row['customer_id'],
        'organization_id' => $row['organization_id'],
        'dressmaker_id' => $row['dressmaker_id'],
        'scan_id' => $row['scan_id'],
        'status' => $row['status'],
        'garment_type' => $row['garment_type'],
        'due_date' => $row['due_date'],
        'notes' => $row['notes'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}

function fittingResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'order_id' => $row['order_id'],
        'starts_at' => $row['starts_at'],
        'location' => $row['location'],
        'status' => $row['status'],
        'notes' => $row['notes'],
        'created_at' => $row['created_at'],
    ];
}

function invitationResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'organization_id' => $row['organization_id'],
        'email' => $row['email'],
        'invited_role' => $row['invited_role'],
        'token_hash' => $row['token_hash'],
        'expires_at' => $row['expires_at'],
        'accepted_at' => $row['accepted_at'],
        'revoked_at' => $row['revoked_at'],
        'invited_by' => $row['invited_by'],
        'created_at' => $row['created_at'],
    ];
}

function notificationResponse(array $row): array
{
    return [
        'id' => $row['id'],
        'user_id' => $row['user_id'],
        'type' => $row['type'],
        'title' => $row['title'],
        'body' => $row['body'],
        'read_at' => $row['read_at'],
        'metadata' => jsonValue($row['metadata'] ?? null),
        'created_at' => $row['created_at'],
    ];
}

function ensureOrderReadyNotification(array $order): void
{
    $eventKey = 'order-ready:' . $order['id'];
    $statement = database()->prepare('SELECT id FROM notifications WHERE event_key = ? LIMIT 1');
    $statement->execute([$eventKey]);
    if ($statement->fetch()) return;
    try {
        $statement = database()->prepare('INSERT INTO notifications (id, user_id, type, title, body, metadata, event_key) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $statement->execute([
            uuid(),
            $order['customer_id'],
            'order_ready',
            'Your order is ready',
            substr((string) $order['garment_type'] . ' is ready for pickup. Please contact your dressmaker for collection details.', 0, 1000),
            json_encode(['order_id' => $order['id'], 'status' => $order['status']], JSON_UNESCAPED_SLASHES),
            $eventKey,
        ]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() !== '23000') throw $error;
    }
}

function isAdmin(array $user): bool
{
    return $user['role'] === 'admin';
}

function requireAdmin(): array
{
    $user = requireUser();
    if (!isAdmin($user)) throw new SukatApiException('Administrator access is required.', 403);
    return $user;
}

function requireOrganizationStaff(array $user, ?string $organizationId): void
{
    if (isAdmin($user)) return;
    if (!in_array($user['role'], ['dressmaker', 'admin'], true) || !$organizationId || $user['organization_id'] !== $organizationId) {
        throw new SukatApiException('You do not have access to this organization.', 403);
    }
}

function findScan(string $scanId): ?array
{
    $statement = database()->prepare('SELECT * FROM scans WHERE id = ? LIMIT 1');
    $statement->execute([$scanId]);
    return $statement->fetch() ?: null;
}

function requireScan(string $scanId, array $user): array
{
    $scan = findScan($scanId);
    if (!$scan) throw new SukatApiException('Scan not found.', 404);
    $allowed = $scan['customer_id'] === $user['id'] || isAdmin($user) || (
        in_array($user['role'], ['dressmaker', 'admin'], true)
        && $scan['organization_id'] !== null
        && $scan['organization_id'] === $user['organization_id']
    );
    if (!$allowed) throw new SukatApiException('You do not have access to this scan.', 403);
    return $scan;
}

function requestOrigin(): string
{
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

function apiUrl(string $action, array $params = []): string
{
    $script = $_SERVER['SCRIPT_NAME'] ?? '/api/index.php';
    return requestOrigin() . $script . '?' . http_build_query(array_merge(['action' => $action], $params));
}

function publicAssetUrl(string $path): string
{
    $script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/api/index.php');
    $directory = rtrim(dirname($script), '/');
    if (substr($directory, -4) === '/api') $directory = substr($directory, 0, -4);
    return requestOrigin() . rtrim($directory, '/') . '/' . ltrim($path, '/');
}

function safeStorageFile(string $relativePath): string
{
    global $config;
    $relativePath = str_replace('\\', '/', ltrim($relativePath, '/'));
    if ($relativePath === '' || str_contains($relativePath, '..')) throw new SukatApiException('Invalid storage path.', 400);
    if (!is_dir($config['storage_dir'])) mkdir($config['storage_dir'], 0700, true);
    $root = realpath($config['storage_dir']);
    if ($root === false) throw new SukatApiException('Storage is not available.', 500);
    $candidate = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    $real = realpath($candidate);
    if ($real === false || ($real !== $root && strpos($real, $root . DIRECTORY_SEPARATOR) !== 0)) {
        throw new SukatApiException('Stored asset was not found.', 404);
    }
    return $real;
}

function storageDirectory(string $relativePath): string
{
    global $config;
    $relativePath = str_replace('\\', '/', ltrim($relativePath, '/'));
    if ($relativePath === '' || str_contains($relativePath, '..')) throw new SukatApiException('Invalid storage path.', 400);
    if (!is_dir($config['storage_dir'])) mkdir($config['storage_dir'], 0700, true);
    $root = realpath($config['storage_dir']);
    if ($root === false) throw new SukatApiException('Storage is not available.', 500);
    $directory = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new SukatApiException('Storage directory could not be created.', 500);
    }
    $real = realpath($directory);
    if ($real === false || ($real !== $root && strpos($real, $root . DIRECTORY_SEPARATOR) !== 0)) throw new SukatApiException('Invalid storage directory.', 400);
    return $real;
}

function localMeasurementTemplate(): array
{
    return [
        ['key' => 'ankle_left_circumference', 'value' => 24.3, 'confidence' => 62],
        ['key' => 'bicep_right_circumference', 'value' => 33.3, 'confidence' => 67],
        ['key' => 'calf_left_circumference', 'value' => 36.4, 'confidence' => 64],
        ['key' => 'chest', 'value' => 100.1, 'confidence' => 72],
        ['key' => 'forearm_circumference', 'value' => 28.0, 'confidence' => 65],
        ['key' => 'head_circumference', 'value' => 59.7, 'confidence' => 60],
        ['key' => 'hip', 'value' => 94.8, 'confidence' => 72],
        ['key' => 'neck', 'value' => 37.6, 'confidence' => 66],
        ['key' => 'thigh_left_circumference', 'value' => 55.3, 'confidence' => 68],
        ['key' => 'waist', 'value' => 82.2, 'confidence' => 72],
        ['key' => 'wrist_right_circumference', 'value' => 17.5, 'confidence' => 61],
        ['key' => 'arm', 'value' => 57.3, 'confidence' => 67],
        ['key' => 'back_to_shoulder', 'value' => 21.2, 'confidence' => 63],
        ['key' => 'inseam', 'value' => 72.4, 'confidence' => 68],
        ['key' => 'neck_to_pelvis', 'value' => 68.6, 'confidence' => 64],
        ['key' => 'foot_length', 'value' => 26.2, 'confidence' => 60],
        ['key' => 'foot_width', 'value' => 9.7, 'confidence' => 58],
        ['key' => 'shoulder', 'value' => 52.5, 'confidence' => 70],
    ];
}

function invitationRedirectUrl(?string $value): string
{
    $base = $value ?: requestOrigin() . '/';
    $parts = parse_url($base);
    if (!$parts || empty($parts['scheme']) || empty($parts['host']) || !in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        throw new SukatApiException('The invitation redirect URL is invalid.', 400);
    }
    $origin = strtolower($parts['scheme']) . '://' . strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    $requestOriginValue = strtolower(requestOrigin());
    $localOrigin = (bool) preg_match('/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i', $origin);
    if ($origin !== $requestOriginValue && !$localOrigin) throw new SukatApiException('The invitation redirect URL is not an allowed application origin.', 400);
    return $base;
}

function failProcessingScan(?string $scanId): void
{
    if (!$scanId) return;
    try {
        $statement = database()->prepare("UPDATE scans SET status = 'failed', failure_reason = ?, updated_at = NOW() WHERE id = ? AND status = 'processing'");
        $statement->execute(['The local processing service could not complete this scan.', $scanId]);
    } catch (Throwable $error) {
        error_log('SukatAI could not persist scan processing failure: ' . $error->getMessage());
    }
}

$action = stringInput($_GET, 'action', '') ?? '';
$getActions = ['health', 'session', 'profile', 'notifications', 'organizations', 'invitations', 'admin_scans', 'admin_orders', 'asset'];
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' && !in_array($action, $getActions, true)) {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'Use POST for this action.'], JSON_UNESCAPED_SLASHES);
    exit;
}
$processingScanId = null;

try {
    switch ($action) {
        case 'health':
            database()->query('SELECT 1');
            jsonResponse(['backend' => 'xampp', 'database' => 'mysql']);
            break;

        case 'session': {
            $user = currentUser();
            jsonResponse($user ? sessionPayload($user) : null);
        }

        case 'sign_in': {
            $data = requestData();
            $email = strtolower(stringInput($data, 'email', '') ?? '');
            $password = stringInput($data, 'password', '') ?? '';
            $statement = database()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
            $statement->execute([$email]);
            $user = $statement->fetch() ?: null;
            if (!$user || !password_verify($password, $user['password_hash'])) throw new SukatApiException('The email or password is incorrect.', 401);
            session_regenerate_id(true);
            $_SESSION['user_id'] = $user['id'];
            jsonResponse(['session' => sessionPayload($user), 'user' => publicUser($user)]);
        }

        case 'sign_up': {
            $data = requestData();
            $firstName = stringInput($data, 'first_name', '') ?? '';
            $lastName = stringInput($data, 'last_name', '') ?? '';
            $email = strtolower(stringInput($data, 'email', '') ?? '');
            $password = stringInput($data, 'password', '') ?? '';
            if ($firstName === '' || $lastName === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new SukatApiException('Enter a valid name and email address.', 400);
            if (strlen($password) < 8) throw new SukatApiException('Use a password with at least 8 characters.', 400);
            $id = uuid();
            try {
                $statement = database()->prepare('INSERT INTO users (id, role, first_name, last_name, email, password_hash, unit_system) VALUES (?, ?, ?, ?, ?, ?, ?)');
                $statement->execute([$id, 'customer', substr($firstName, 0, 80), substr($lastName, 0, 80), $email, password_hash($password, PASSWORD_DEFAULT), 'cm']);
            } catch (PDOException $error) {
                if ((string) $error->getCode() === '23000') throw new SukatApiException('An account with that email already exists.', 409);
                throw $error;
            }
            $user = currentUser();
            if ($user) unset($_SESSION['user_id']);
            $statement = database()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$id]);
            $user = $statement->fetch();
            session_regenerate_id(true);
            $_SESSION['user_id'] = $id;
            jsonResponse(['session' => sessionPayload($user), 'user' => publicUser($user)]);
        }

        case 'sign_out':
            $_SESSION = [];
            session_destroy();
            jsonResponse(true);

        case 'profile':
            jsonResponse(profileResponse(requireUser()));

        case 'profile_update': {
            $user = requireUser();
            $data = requestData();
            $firstName = stringInput($data, 'first_name', $user['first_name']) ?? $user['first_name'];
            $lastName = stringInput($data, 'last_name', $user['last_name']) ?? $user['last_name'];
            $unit = stringInput($data, 'unit_system', $user['unit_system']) ?? $user['unit_system'];
            $phone = normalizePhone(stringInput($data, 'phone', $user['phone'] ?? ''));
            $emailNotifications = array_key_exists('email_notifications', $data) ? booleanInput($data['email_notifications']) : (array_key_exists('email_notifications', $user) ? booleanInput($user['email_notifications']) : true);
            $smsNotifications = array_key_exists('sms_notifications', $data) ? booleanInput($data['sms_notifications']) : (array_key_exists('sms_notifications', $user) ? booleanInput($user['sms_notifications']) : false);
            if ($firstName === '' || $lastName === '' || !in_array($unit, ['cm', 'ftin'], true)) throw new SukatApiException('Profile values are invalid.', 400);
            if ($smsNotifications && $phone === null) throw new SukatApiException('Add a phone number before enabling text notifications.', 400);
            $statement = database()->prepare('UPDATE users SET first_name = ?, last_name = ?, phone = ?, email_notifications = ?, sms_notifications = ?, unit_system = ?, updated_at = NOW() WHERE id = ?');
            $statement->execute([substr($firstName, 0, 80), substr($lastName, 0, 80), $phone, $emailNotifications ? 1 : 0, $smsNotifications ? 1 : 0, $unit, $user['id']]);
            $statement = database()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$user['id']]);
            jsonResponse(profileResponse($statement->fetch()));
        }

        case 'password_reset_request': {
            $data = requestData();
            $email = strtolower(stringInput($data, 'email', '') ?? '');
            $statement = database()->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
            $statement->execute([$email]);
            $user = $statement->fetch();
            if ($user) {
                $token = bin2hex(random_bytes(24));
                $statement = database()->prepare('UPDATE users SET reset_token_hash = ?, reset_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?');
                $statement->execute([hash('sha256', $token), $user['id']]);
            }
            jsonResponse(true);
        }

        case 'password_update': {
            $user = requireUser();
            $data = requestData();
            $password = stringInput($data, 'password', '') ?? '';
            if (strlen($password) < 8) throw new SukatApiException('Use a password with at least 8 characters.', 400);
            $statement = database()->prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, updated_at = NOW() WHERE id = ?');
            $statement->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
            $statement = database()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$user['id']]);
            jsonResponse(publicUser($statement->fetch()));
        }

        case 'assign_profile_organization': {
            requireAdmin();
            $data = requestData();
            $profileId = stringInput($data, 'profile_id', '') ?? '';
            $organizationId = stringInput($data, 'organization_id');
            if ($profileId === '') throw new SukatApiException('profile_id is required.', 400);
            if ($organizationId !== null && $organizationId !== '') {
                $statement = database()->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
                $statement->execute([$organizationId]);
                if (!$statement->fetch()) throw new SukatApiException('Organization not found.', 404);
            } else {
                $organizationId = null;
            }
            $statement = database()->prepare('UPDATE users SET organization_id = ?, updated_at = NOW() WHERE id = ?');
            $statement->execute([$organizationId, $profileId]);
            $statement = database()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$profileId]);
            $profile = $statement->fetch();
            if (!$profile) throw new SukatApiException('Profile not found.', 404);
            jsonResponse(profileResponse($profile));
        }

        case 'notifications': {
            $user = requireUser();
            $statement = database()->prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20');
            $statement->execute([$user['id']]);
            jsonResponse(array_map('notificationResponse', $statement->fetchAll()));
        }

        case 'mark_notification_read': {
            $user = requireUser();
            $data = requestData();
            $id = stringInput($data, 'notification_id', '') ?? '';
            $statement = database()->prepare('UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?');
            $statement->execute([$id, $user['id']]);
            jsonResponse(true);
        }

        case 'organizations': {
            $user = requireUser();
            if (isAdmin($user)) {
                $statement = database()->query('SELECT * FROM organizations ORDER BY name');
            } else {
                $statement = database()->prepare('SELECT * FROM organizations WHERE owner_id = ? OR id = ? ORDER BY name');
                $statement->execute([$user['id'], $user['organization_id']]);
            }
            jsonResponse(array_map('organizationResponse', $statement->fetchAll()));
        }

        case 'invitations': {
            requireAdmin();
            $statement = database()->query('SELECT * FROM dressmaker_invitations ORDER BY created_at DESC');
            jsonResponse(array_map('invitationResponse', $statement->fetchAll()));
        }

        case 'invite_dressmaker': {
            $user = requireAdmin();
            $data = requestData();
            $email = strtolower(stringInput($data, 'email', '') ?? '');
            $organizationId = stringInput($data, 'organization_id', '') ?? '';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $organizationId === '') throw new SukatApiException('Enter a valid email and organization.', 400);
            $statement = database()->prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1');
            $statement->execute([$organizationId]);
            if (!$statement->fetch()) throw new SukatApiException('Organization not found.', 404);
            $token = bin2hex(random_bytes(24));
            $id = uuid();
            $statement = database()->prepare('INSERT INTO dressmaker_invitations (id, organization_id, email, invited_role, token_hash, expires_at, invited_by) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)');
            $statement->execute([$id, $organizationId, $email, 'dressmaker', hash('sha256', $token), $user['id']]);
            $redirect = stringInput($data, 'redirect_to', '') ?? '';
            $inviteUrl = invitationRedirectUrl($redirect);
            if (preg_match('/([?&])invite=[^&]*/', $inviteUrl)) {
                $inviteUrl = preg_replace('/([?&])invite=[^&]*/', '$1invite=' . rawurlencode($token), $inviteUrl, 1) ?: $inviteUrl;
            } else {
                $separator = str_contains($inviteUrl, '?') ? '&' : '?';
                $inviteUrl .= $separator . 'invite=' . rawurlencode($token);
            }
            jsonResponse(['invitation_id' => $id, 'invite_url' => $inviteUrl]);
        }

        case 'accept_dressmaker_invitation': {
            $user = requireUser();
            $data = requestData();
            $token = stringInput($data, 'token', '') ?? '';
            $firstName = stringInput($data, 'first_name', $user['first_name']) ?? $user['first_name'];
            $lastName = stringInput($data, 'last_name', $user['last_name']) ?? $user['last_name'];
            if ($token === '' || $firstName === '' || $lastName === '') throw new SukatApiException('Invitation token and name are required.', 400);
            $db = database();
            $db->beginTransaction();
            try {
                $statement = $db->prepare('SELECT * FROM dressmaker_invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1 FOR UPDATE');
                $statement->execute([hash('sha256', $token)]);
                $invitation = $statement->fetch() ?: null;
                if (!$invitation) throw new SukatApiException('This invitation is invalid, expired, or already accepted.', 400);
                if (strtolower((string) $user['email']) !== strtolower((string) $invitation['email'])) throw new SukatApiException('Sign in with the email address that received this invitation.', 403);
                if ($user['role'] !== 'customer' && !($user['role'] === 'dressmaker' && $user['organization_id'] === $invitation['organization_id'])) {
                    throw new SukatApiException('This account cannot accept a dressmaker invitation.', 403);
                }
                $statement = $db->prepare('UPDATE users SET role = ?, organization_id = ?, first_name = ?, last_name = ?, updated_at = NOW() WHERE id = ?');
                $statement->execute(['dressmaker', $invitation['organization_id'], substr($firstName, 0, 80), substr($lastName, 0, 80), $user['id']]);
                $statement = $db->prepare('UPDATE dressmaker_invitations SET accepted_at = NOW() WHERE id = ? AND accepted_at IS NULL');
                $statement->execute([$invitation['id']]);
                if ($statement->rowCount() !== 1) throw new SukatApiException('This invitation is invalid, expired, or already accepted.', 400);
                $db->commit();
            } catch (Throwable $error) {
                $db->rollBack();
                throw $error;
            }
            jsonResponse(['accepted' => true]);
        }

        case 'create_scan': {
            $user = requireUser();
            $data = requestData();
            $heightValue = array_key_exists('height_value', $data) && $data['height_value'] !== null && $data['height_value'] !== '' ? (float) $data['height_value'] : null;
            $heightUnit = stringInput($data, 'height_unit', 'cm') ?? 'cm';
            $captureSource = stringInput($data, 'capture_source', 'upload') ?? 'upload';
            if (!in_array($heightUnit, ['cm', 'ftin'], true) || !in_array($captureSource, ['camera', 'upload'], true)) throw new SukatApiException('Scan setup values are invalid.', 400);
            $id = uuid();
            $statement = database()->prepare('INSERT INTO scans (id, customer_id, organization_id, status, height_value, height_unit, consent_at, capture_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $statement->execute([$id, $user['id'], $user['organization_id'], 'draft', $heightValue, $heightUnit, mysqlDateTime(stringInput($data, 'consent_at')), $captureSource]);
            jsonResponse(scanResponse(findScan($id)));
        }

        case 'update_scan': {
            $user = requireUser();
            $data = requestData();
            $scanId = stringInput($data, 'scan_id', '') ?? '';
            $scan = requireScan($scanId, $user);
            $isCustomer = $scan['customer_id'] === $user['id'];
            if (!$isCustomer) requireOrganizationStaff($user, $scan['organization_id']);
            $suppliedFields = array_values(array_diff(array_keys($data), ['scan_id']));
            $allowedFields = $isCustomer ? ['height_value', 'height_unit', 'status', 'capture_source', 'failure_reason'] : ['status'];
            foreach ($suppliedFields as $field) {
                if (!in_array($field, $allowedFields, true)) throw new SukatApiException($isCustomer ? 'The scan update contains unsupported fields.' : 'Dressmakers can only update the review status of a scan.', 403);
            }
            $fields = [];
            $values = [];
            if (array_key_exists('height_value', $data)) {
                $fields[] = 'height_value = ?';
                $values[] = $data['height_value'] === null || $data['height_value'] === '' ? null : (float) $data['height_value'];
            }
            foreach (['height_unit', 'status', 'capture_source', 'failure_reason'] as $field) {
                if (array_key_exists($field, $data)) {
                    $value = stringInput($data, $field);
                    if ($field === 'status' && !in_array($value, ['draft', 'uploaded', 'processing_queued', 'processing', 'ready_for_review', 'verified', 'needs_recapture', 'failed'], true)) throw new SukatApiException('The scan status is invalid.', 400);
                    if ($field === 'status' && $value !== $scan['status']) {
                        $allowedStatuses = $isCustomer ? ['draft', 'uploaded', 'processing_queued', 'ready_for_review', 'needs_recapture'] : ['verified', 'needs_recapture'];
                        if (!in_array($value, $allowedStatuses, true)) throw new SukatApiException($isCustomer ? 'Customers cannot set a staff or provider status.' : 'Dressmakers can only verify or request recapture for a scan.', 403);
                    }
                    $fields[] = $field . ' = ?';
                    $values[] = $value;
                }
            }
            if ($fields) {
                $values[] = $scan['id'];
                $statement = database()->prepare('UPDATE scans SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE id = ?');
                $statement->execute($values);
            }
            jsonResponse(scanResponse(findScan($scan['id'])));
        }

        case 'scan_bundle': {
            $user = requireUser();
            $data = requestData();
            $scan = requireScan(stringInput($data, 'scan_id', '') ?? '', $user);
            $statement = database()->prepare('SELECT * FROM scan_assets WHERE scan_id = ? ORDER BY asset_type');
            $statement->execute([$scan['id']]);
            $assets = [];
            $includeUrls = filter_var($data['include_signed_urls'] ?? false, FILTER_VALIDATE_BOOLEAN);
            foreach ($statement->fetchAll() as $asset) $assets[] = assetResponse($asset, $includeUrls ? apiUrl('asset', ['path' => $asset['storage_path']]) : null);
            $statement = database()->prepare('SELECT * FROM measurements WHERE scan_id = ? ORDER BY `key`');
            $statement->execute([$scan['id']]);
            $measurements = array_map('measurementResponse', $statement->fetchAll());
            $statement = database()->prepare('SELECT * FROM body_models WHERE scan_id = ? LIMIT 1');
            $statement->execute([$scan['id']]);
            $model = $statement->fetch();
            jsonResponse(['scan' => scanResponse($scan), 'assets' => $assets, 'measurements' => $measurements, 'bodyModel' => $model ? bodyModelResponse($model) : null]);
        }

        case 'customer_scans': {
            $user = requireUser();
            $statement = database()->prepare('SELECT * FROM scans WHERE customer_id = ? ORDER BY updated_at DESC');
            $statement->execute([$user['id']]);
            jsonResponse(array_map('scanResponse', $statement->fetchAll()));
        }

        case 'customer_orders': {
            $user = requireUser();
            $statement = database()->prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC');
            $statement->execute([$user['id']]);
            jsonResponse(array_map('orderResponse', $statement->fetchAll()));
        }

        case 'fittings_for_orders': {
            $user = requireUser();
            $data = requestData();
            $ids = is_array($data['order_ids'] ?? null) ? array_values(array_filter($data['order_ids'], 'is_string')) : [];
            if (!$ids) {
                jsonResponse([]);
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $statement = database()->prepare('SELECT f.* FROM fittings f JOIN orders o ON o.id = f.order_id WHERE f.order_id IN (' . $placeholders . ') AND (o.customer_id = ? OR o.organization_id = ? OR o.dressmaker_id = ?) ORDER BY f.starts_at');
            $statement->execute(array_merge($ids, [$user['id'], $user['organization_id'], $user['id']]));
            jsonResponse(array_map('fittingResponse', $statement->fetchAll()));
        }

        case 'org_customers':
        case 'org_staff':
        case 'org_scans':
        case 'org_orders': {
            $user = requireUser();
            $data = requestData();
            $organizationId = stringInput($data, 'organization_id', '') ?? '';
            requireOrganizationStaff($user, $organizationId);
            if ($action === 'org_customers') {
                $statement = database()->prepare("SELECT * FROM users WHERE organization_id = ? AND role = 'customer' ORDER BY last_name, first_name");
                $statement->execute([$organizationId]);
                jsonResponse(array_map('profileResponse', $statement->fetchAll()));
            }
            if ($action === 'org_staff') {
                $statement = database()->prepare("SELECT * FROM users WHERE organization_id = ? AND role IN ('dressmaker', 'admin') ORDER BY last_name, first_name");
                $statement->execute([$organizationId]);
                jsonResponse(array_map('profileResponse', $statement->fetchAll()));
            }
            if ($action === 'org_scans') {
                $statement = database()->prepare('SELECT * FROM scans WHERE organization_id = ? ORDER BY updated_at DESC');
                $statement->execute([$organizationId]);
                jsonResponse(array_map('scanResponse', $statement->fetchAll()));
            }
            $statement = database()->prepare('SELECT * FROM orders WHERE organization_id = ? ORDER BY created_at DESC');
            $statement->execute([$organizationId]);
            jsonResponse(array_map('orderResponse', $statement->fetchAll()));
        }

        case 'admin_profiles': {
            requireAdmin();
            $data = requestData();
            $role = stringInput($data, 'role');
            if ($role !== null && !in_array($role, ['customer', 'dressmaker', 'admin'], true)) throw new SukatApiException('The profile role is invalid.', 400);
            if ($role) {
                $statement = database()->prepare('SELECT * FROM users WHERE role = ? ORDER BY last_name, first_name');
                $statement->execute([$role]);
            } else {
                $statement = database()->query('SELECT * FROM users ORDER BY last_name, first_name');
            }
            jsonResponse(array_map('profileResponse', $statement->fetchAll()));
        }

        case 'admin_scans':
            requireAdmin();
            $statement = database()->query('SELECT * FROM scans ORDER BY updated_at DESC');
            jsonResponse(array_map('scanResponse', $statement->fetchAll()));

        case 'admin_orders':
            requireAdmin();
            $statement = database()->query('SELECT * FROM orders ORDER BY created_at DESC');
            jsonResponse(array_map('orderResponse', $statement->fetchAll()));

        case 'update_measurement': {
            $user = requireUser();
            $data = requestData();
            $measurementId = stringInput($data, 'measurement_id', '') ?? '';
            $statement = database()->prepare('SELECT m.*, s.organization_id, s.customer_id FROM measurements m JOIN scans s ON s.id = m.scan_id WHERE m.id = ? LIMIT 1');
            $statement->execute([$measurementId]);
            $measurement = $statement->fetch();
            if (!$measurement) throw new SukatApiException('Measurement not found.', 404);
            requireOrganizationStaff($user, $measurement['organization_id']);
            $adjusted = array_key_exists('adjusted_value', $data) && $data['adjusted_value'] !== null && $data['adjusted_value'] !== '' ? (float) $data['adjusted_value'] : null;
            $reason = $adjusted === null ? null : stringInput($data, 'adjustment_reason');
            $statement = database()->prepare('UPDATE measurements SET adjusted_value = ?, adjusted_by = ?, adjustment_reason = ?, updated_at = NOW() WHERE id = ?');
            $statement->execute([$adjusted, $adjusted === null ? null : $user['id'], $reason, $measurementId]);
            $statement = database()->prepare('SELECT * FROM measurements WHERE id = ? LIMIT 1');
            $statement->execute([$measurementId]);
            jsonResponse(measurementResponse($statement->fetch()));
        }

        case 'add_review_event': {
            $user = requireUser();
            $data = requestData();
            $scan = requireScan(stringInput($data, 'scan_id', '') ?? '', $user);
            requireOrganizationStaff($user, $scan['organization_id']);
            $eventType = stringInput($data, 'event_type', '') ?? '';
            if (!in_array($eventType, ['opened', 'adjusted', 'approved', 'recapture_requested', 'photo_accessed', 'deleted'], true)) throw new SukatApiException('The review event is invalid.', 400);
            $statement = database()->prepare('INSERT INTO measurement_review_events (id, scan_id, actor_id, event_type, payload) VALUES (?, ?, ?, ?, ?)');
            $statement->execute([uuid(), $scan['id'], $user['id'], $eventType, json_encode(is_array($data['payload'] ?? null) ? $data['payload'] : [], JSON_UNESCAPED_SLASHES)]);
            jsonResponse(true);
        }

        case 'create_order': {
            $user = requireUser();
            $data = requestData();
            $scanId = stringInput($data, 'scan_id', '') ?? '';
            $scan = findScan($scanId);
            if (!$scan || $scan['customer_id'] !== $user['id']) throw new SukatApiException('A customer-owned scan is required.', 403);
            if ($scan['status'] !== 'verified') throw new SukatApiException('Only verified measurements can be attached to an order.', 400);
            $garment = stringInput($data, 'garment_type', '') ?? '';
            if (strlen($garment) < 2) throw new SukatApiException('Enter a garment type.', 400);
            $id = uuid();
            $statement = database()->prepare('INSERT INTO orders (id, customer_id, organization_id, scan_id, status, garment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $statement->execute([$id, $user['id'], $user['organization_id'], $scanId, 'new', substr($garment, 0, 120), stringInput($data, 'notes')]);
            $statement = database()->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
            $statement->execute([$id]);
            jsonResponse(orderResponse($statement->fetch()));
        }

        case 'update_order': {
            $user = requireUser();
            $data = requestData();
            $orderId = stringInput($data, 'order_id', '') ?? '';
            $statement = database()->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
            $statement->execute([$orderId]);
            $order = $statement->fetch();
            if (!$order) throw new SukatApiException('Order not found.', 404);
            if ($order['customer_id'] !== $user['id']) requireOrganizationStaff($user, $order['organization_id']);
            $status = stringInput($data, 'status', '') ?? '';
            if (!in_array($status, ['new', 'accepted', 'in_production', 'for_fitting', 'ready_for_pickup', 'completed', 'cancelled'], true)) throw new SukatApiException('The order status is invalid.', 400);
            if ($order['customer_id'] === $user['id'] && $status !== $order['status']) throw new SukatApiException('Only your dressmaker can update the production status.', 403);
            $statement = database()->prepare('UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ? AND status = ?');
            $statement->execute([$status, $orderId, $order['status']]);
            if ($statement->rowCount() > 0 && $status === 'ready_for_pickup' && $order['status'] !== $status) {
                $updatedOrder = $order;
                $updatedOrder['status'] = $status;
                ensureOrderReadyNotification($updatedOrder);
            }
            $statement = database()->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
            $statement->execute([$orderId]);
            jsonResponse(orderResponse($statement->fetch()));
        }

        case 'create_fitting': {
            $user = requireUser();
            $data = requestData();
            $orderId = stringInput($data, 'order_id', '') ?? '';
            $statement = database()->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
            $statement->execute([$orderId]);
            $order = $statement->fetch();
            if (!$order) throw new SukatApiException('Order not found.', 404);
            requireOrganizationStaff($user, $order['organization_id']);
            $startsAt = mysqlDateTime(stringInput($data, 'starts_at'));
            if ($startsAt === null) throw new SukatApiException('A fitting date is required.', 400);
            $id = uuid();
            $statement = database()->prepare('INSERT INTO fittings (id, order_id, starts_at, location, status, notes) VALUES (?, ?, ?, ?, ?, ?)');
            $statement->execute([$id, $orderId, $startsAt, stringInput($data, 'location'), 'requested', stringInput($data, 'notes')]);
            $statement = database()->prepare('SELECT * FROM fittings WHERE id = ? LIMIT 1');
            $statement->execute([$id]);
            jsonResponse(fittingResponse($statement->fetch()));
        }

        case 'update_fitting': {
            $user = requireUser();
            $data = requestData();
            $fittingId = stringInput($data, 'fitting_id', '') ?? '';
            $statement = database()->prepare('SELECT f.*, o.customer_id, o.organization_id FROM fittings f JOIN orders o ON o.id = f.order_id WHERE f.id = ? LIMIT 1');
            $statement->execute([$fittingId]);
            $fitting = $statement->fetch();
            if (!$fitting) throw new SukatApiException('Fitting not found.', 404);
            requireOrganizationStaff($user, $fitting['organization_id']);
            $status = stringInput($data, 'status', '') ?? '';
            if (!in_array($status, ['requested', 'confirmed', 'completed', 'reschedule_requested', 'cancelled'], true)) throw new SukatApiException('The fitting status is invalid.', 400);
            $statement = database()->prepare('UPDATE fittings SET status = ? WHERE id = ?');
            $statement->execute([$status, $fittingId]);
            $statement = database()->prepare('SELECT * FROM fittings WHERE id = ? LIMIT 1');
            $statement->execute([$fittingId]);
            jsonResponse(fittingResponse($statement->fetch()));
        }

        case 'create_organization': {
            $user = requireAdmin();
            $data = requestData();
            $name = stringInput($data, 'name', '') ?? '';
            if (strlen($name) < 2) throw new SukatApiException('Enter an organization name.', 400);
            $id = uuid();
            $statement = database()->prepare('INSERT INTO organizations (id, name, owner_id, settings) VALUES (?, ?, ?, ?)');
            $statement->execute([$id, substr($name, 0, 120), $user['id'], '{}']);
            $statement = database()->prepare('SELECT * FROM organizations WHERE id = ? LIMIT 1');
            $statement->execute([$id]);
            jsonResponse(organizationResponse($statement->fetch()));
        }

        case 'upload_scan_asset': {
            $user = requireUser();
            $scanId = stringInput($_POST, 'scan_id', '') ?? '';
            $scan = findScan($scanId);
            if (!$scan || $scan['customer_id'] !== $user['id']) throw new SukatApiException('Only the scan owner can upload capture views.', 403);
            $assetType = stringInput($_POST, 'asset_type', '') ?? '';
            if (!in_array($assetType, ['front', 'side', 'back'], true)) throw new SukatApiException('The capture view is invalid.', 400);
            if (!isset($_FILES['file']) || !is_array($_FILES['file']) || (int) $_FILES['file']['error'] !== UPLOAD_ERR_OK) throw new SukatApiException('The image upload did not complete.', 400);
            $file = $_FILES['file'];
            if ((int) $file['size'] > 10 * 1024 * 1024) throw new SukatApiException('Images must be smaller than 10 MB.', 400);
            $fileInfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $fileInfo->file($file['tmp_name']);
            $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
            if (!isset($extensions[$mime])) throw new SukatApiException('Use a JPG, PNG, or WebP image.', 400);
            $relativeDirectory = 'scan-captures/' . ($scan['organization_id'] ?: 'unassigned') . '/' . $scan['customer_id'] . '/' . $scan['id'];
            $directory = storageDirectory($relativeDirectory);
            $relativePath = $relativeDirectory . '/' . $assetType . '-' . bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
            $destination = $directory . DIRECTORY_SEPARATOR . basename($relativePath);
            if (!move_uploaded_file($file['tmp_name'], $destination)) throw new SukatApiException('The image could not be saved.', 500);
            try {
                $metadata = json_encode([
                    'original_name' => basename((string) $file['name']),
                    'content_type' => $mime,
                    'size_bytes' => (int) $file['size'],
                    'last_modified' => null,
                ], JSON_UNESCAPED_SLASHES);
                $statement = database()->prepare('INSERT INTO scan_assets (id, scan_id, asset_type, storage_path, metadata, quality_status) VALUES (?, ?, ?, ?, ?, ?)');
                $statement->execute([uuid(), $scan['id'], $assetType, $relativePath, $metadata, 'pending']);
            } catch (Throwable $error) {
                if (is_file($destination)) unlink($destination);
                if ($error instanceof PDOException && (string) $error->getCode() === '23000') throw new SukatApiException('That scan view already has an upload. Remove it before uploading another.', 409);
                throw $error;
            }
            $statement = database()->prepare('SELECT * FROM scan_assets WHERE storage_path = ? LIMIT 1');
            $statement->execute([$relativePath]);
            $asset = $statement->fetch();
            jsonResponse(assetResponse($asset, apiUrl('asset', ['path' => $relativePath])));
        }

        case 'delete_scan_asset': {
            $user = requireUser();
            $data = requestData();
            $assetId = stringInput($data, 'asset_id', '') ?? '';
            $statement = database()->prepare('SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.id = ? LIMIT 1');
            $statement->execute([$assetId]);
            $asset = $statement->fetch();
            if (!$asset) throw new SukatApiException('Scan asset not found.', 404);
            if ($asset['customer_id'] !== $user['id'] && !isAdmin($user)) throw new SukatApiException('You cannot delete this scan asset.', 403);
            try {
                $file = safeStorageFile($asset['storage_path']);
                if (is_file($file)) unlink($file);
            } catch (SukatApiException $error) {
                if ($error->status !== 404) throw $error;
            }
            $statement = database()->prepare('DELETE FROM scan_assets WHERE id = ?');
            $statement->execute([$assetId]);
            jsonResponse(true);
        }

        case 'signed_url': {
            $user = requireUser();
            $data = requestData();
            $bucket = stringInput($data, 'bucket', '') ?? '';
            $path = stringInput($data, 'path', '') ?? '';
            if ($bucket === 'body-models' && $path === 'local-reference-3d-body-scan') {
                jsonResponse(publicAssetUrl('media/3d-body-scan-reference-v2.png'));
            }
            if ($bucket === 'scan-captures') {
                $statement = database()->prepare('SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.storage_path = ? LIMIT 1');
                $statement->execute([$path]);
                $asset = $statement->fetch();
                if (!$asset) throw new SukatApiException('Stored asset was not found.', 404);
                requireScan($asset['scan_id'], $user);
                jsonResponse(apiUrl('asset', ['path' => $path]));
            }
            if ($bucket === 'body-models') {
                $statement = database()->prepare('SELECT bm.*, s.customer_id, s.organization_id FROM body_models bm JOIN scans s ON s.id = bm.scan_id WHERE bm.model_url_or_path = ? LIMIT 1');
                $statement->execute([$path]);
                $model = $statement->fetch();
                if (!$model) throw new SukatApiException('Body model was not found.', 404);
                requireScan($model['scan_id'], $user);
                jsonResponse(apiUrl('asset', ['path' => $path]));
            }
            throw new SukatApiException('The storage bucket is invalid.', 400);
        }

        case 'asset': {
            $user = requireUser();
            $path = stringInput($_GET, 'path', '') ?? '';
            $statement = database()->prepare('SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.storage_path = ? LIMIT 1');
            $statement->execute([$path]);
            $asset = $statement->fetch();
            if ($asset) {
                requireScan($asset['scan_id'], $user);
            } else {
                $statement = database()->prepare('SELECT bm.*, s.customer_id, s.organization_id FROM body_models bm JOIN scans s ON s.id = bm.scan_id WHERE bm.model_url_or_path = ? LIMIT 1');
                $statement->execute([$path]);
                $model = $statement->fetch();
                if (!$model) throw new SukatApiException('Stored asset was not found.', 404);
                requireScan($model['scan_id'], $user);
            }
            $file = safeStorageFile($path);
            $fileInfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $fileInfo->file($file) ?: 'application/octet-stream';
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . filesize($file));
            header('Content-Disposition: inline; filename="' . basename($file) . '"');
            readfile($file);
            exit;
        }

        case 'process_scan': {
            $user = requireUser();
            $data = requestData();
            $scan = requireScan(stringInput($data, 'scan_id', '') ?? '', $user);
            $processingScanId = $scan['id'];
            $statement = database()->prepare('SELECT * FROM scan_assets WHERE scan_id = ?');
            $statement->execute([$scan['id']]);
            $assets = $statement->fetchAll();
            $types = array_column($assets, 'asset_type');
            foreach (['front', 'side', 'back'] as $required) {
                if (!in_array($required, $types, true)) {
                    $statement = database()->prepare("UPDATE scans SET status = ?, failure_reason = ?, updated_at = NOW() WHERE id = ? AND status NOT IN ('ready_for_review', 'verified')");
                    $statement->execute(['failed', 'Front, side, and back views are required.', $scan['id']]);
                    $current = $statement->rowCount() === 0 ? findScan($scan['id']) : null;
                    if ($current && in_array($current['status'], ['ready_for_review', 'verified'], true)) {
                        jsonResponse(['status' => 'ready_for_review', 'message' => 'Your scan result is already ready for review.']);
                    }
                    jsonResponse(['status' => 'failed', 'message' => 'Front, side, and back views are required.']);
                }
            }
            $statement = database()->prepare("UPDATE scans SET status = ?, processing_provider = ?, failure_reason = NULL, updated_at = NOW() WHERE id = ? AND (status IN ('uploaded', 'processing_queued', 'failed', 'draft') OR (status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)))");
            $statement->execute(['processing', 'local', $scan['id']]);
            if ($statement->rowCount() === 0) {
                $current = findScan($scan['id']);
                if (!$current || $current['status'] !== 'processing') {
                    jsonResponse(['status' => $current['status'] ?? $scan['status'], 'message' => 'This scan is already being processed or is not ready to process.']);
                }
            }
            $height = $scan['height_value'] === null ? 170.0 : (float) $scan['height_value'];
            if ($scan['height_unit'] === 'ftin') $height *= 2.54;
            $scale = min(1.14, max(0.86, $height / 170.0));
            $hasHeight = $scan['height_value'] !== null && is_numeric($scan['height_value']);
            $penalty = $hasHeight ? 0 : 10;
            $db = database();
            $db->beginTransaction();
            try {
                $statement = $db->prepare('INSERT INTO measurements (id, scan_id, `key`, value, unit, confidence, ai_value) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), confidence = VALUES(confidence), ai_value = VALUES(ai_value), updated_at = NOW()');
                foreach (localMeasurementTemplate() as $measurement) {
                    $value = round((float) $measurement['value'] * $scale, 1);
                    $confidence = max(45, (float) $measurement['confidence'] - $penalty);
                    $statement->execute([uuid(), $scan['id'], $measurement['key'], $value, 'cm', $confidence, $value]);
                }
                $previewData = json_encode([
                    'kind' => 'local-reference-3d-body-scan',
                    'reference_image' => '/media/3d-body-scan-reference-v2.png',
                    'source' => 'local reference image; not a personalized scan',
                ], JSON_UNESCAPED_SLASHES);
                $statement = $db->prepare('INSERT INTO body_models (id, scan_id, provider, model_url_or_path, preview_data, status) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE provider = VALUES(provider), model_url_or_path = VALUES(model_url_or_path), preview_data = VALUES(preview_data), status = VALUES(status)');
                $statement->execute([uuid(), $scan['id'], 'local', 'local-reference-3d-body-scan', $previewData, 'ready']);
                $statement = $db->prepare("UPDATE scans SET status = ?, processing_provider = ?, processing_version = ?, failure_reason = NULL, updated_at = NOW() WHERE id = ? AND status = 'processing'");
                $statement->execute(['ready_for_review', 'local', 'xampp-local-demo-v1', $scan['id']]);
                if ($statement->rowCount() !== 1) throw new SukatApiException('The scan changed while it was being processed.', 409);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
            $processingScanId = null;
            jsonResponse(['status' => 'ready_for_review', 'message' => 'XAMPP local demo result is ready for tailor review.']);
        }

        default:
            throw new SukatApiException('Unknown XAMPP API action.', 404);
    }
} catch (SukatApiException $error) {
    failProcessingScan($processingScanId);
    jsonError($error->getMessage(), $error->status);
} catch (PDOException $error) {
    failProcessingScan($processingScanId);
    error_log('SukatAI MySQL error: ' . $error->getMessage());
    jsonError('The XAMPP database is unavailable. Import xampp/database/sukatai.sql and start MySQL in XAMPP.', 500);
} catch (Throwable $error) {
    failProcessingScan($processingScanId);
    error_log('SukatAI API error: ' . $error->getMessage());
    jsonError('The XAMPP API could not complete the request.', 500);
}
