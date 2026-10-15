<?php

declare(strict_types=1);

// Only this diagnostic state is intentionally retained by a worker.
$mode = getenv('FRANKENPHP_MODE') ?: 'normal';
$state = ['boot_id' => bin2hex(random_bytes(8)), 'count' => 0];
$handler = static function () use ($mode, &$state): void {
    http_response_code(200);
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-PoC-Runtime: FrankenPHP');

    if (!in_array($method, ['GET', 'HEAD'], true)) {
        http_response_code(405);
        header('Allow: GET, HEAD');
        $body = ['error' => 'Method not allowed'];
    } elseif (!in_array($path, ['/', '/hello', '/healthz', '/state'], true)) {
        http_response_code(404);
        $body = ['error' => 'Not found'];
    } else {
        $body = [
            'service' => 'staticphp-lambda-web-poc',
            'status' => 'ok',
            'mode' => $mode,
            'message' => 'Hello from PHP!',
            'path' => $path,
            'php_version' => PHP_VERSION,
            'sapi' => PHP_SAPI,
            'zts' => (bool) PHP_ZTS,
            'pid' => getmypid(),
            'request_id' => $_SERVER['HTTP_LAMBDA_WEB_REQUEST_ID'] ?? null,
        ];
    }
    if ($path === '/state' && http_response_code() === 200) {
        ++$state['count'];
        $body['state'] = [
            'boot_id' => $state['boot_id'],
            'count' => $state['count'],
            'marker' => $_GET['marker'] ?? null,
        ];
    }
    if ($method !== 'HEAD') {
        echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
    }
};

if ($mode === 'worker') {
    // Bootstrap state lives outside the request callback. No PHP exit() in it.
    while (frankenphp_handle_request($handler)) {
        gc_collect_cycles();
    }
} else {
    $handler();
}
