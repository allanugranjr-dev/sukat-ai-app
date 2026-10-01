<?php
require_once __DIR__ . '/lib/PHPMailer/Exception.php';
require_once __DIR__ . '/lib/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/lib/PHPMailer/SMTP.php';
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

// Returns ['status'=>'sent'|'not_configured'|'failed', 'provider'=>'smtp'|'console', 'error'=>?string]
function sendMailViaSmtp(array $cfg, string $to, string $subject, string $text, string $html): array
{
    // Only host/user/pass are required, matching the Node runtime. A missing
    // From is NOT treated as "not configured" (that divergence would make PHP
    // suppress the email and leak the dev code while Node sent it); instead fall
    // back to the authenticated SMTP mailbox, which Gmail requires anyway.
    if (empty($cfg['host']) || empty($cfg['user']) || empty($cfg['pass'])) {
        return ['status' => 'not_configured', 'provider' => 'console', 'error' => 'SMTP is not configured.'];
    }
    $fromAddress = !empty($cfg['from']) ? $cfg['from'] : $cfg['user'];
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = $cfg['host'];
        $mail->SMTPAuth = true;
        $mail->Username = $cfg['user'];
        $mail->Password = $cfg['pass'];
        $mail->Port = (int) ($cfg['port'] ?? 587);
        $secure = strtolower((string) ($cfg['secure'] ?? 'tls'));
        $mail->SMTPSecure = $secure === 'ssl' ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
        $mail->setFrom($fromAddress, 'SukatAI');
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $mail->Body = $html;
        $mail->AltBody = $text;
        $mail->send();
        return ['status' => 'sent', 'provider' => 'smtp', 'error' => null];
    } catch (MailException $e) {
        return ['status' => 'failed', 'provider' => 'smtp', 'error' => 'Email delivery failed: ' . substr($mail->ErrorInfo, 0, 300)];
    }
}
