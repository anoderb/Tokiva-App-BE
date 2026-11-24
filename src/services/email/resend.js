import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 10_000;

let customEmailSender = null;

/**
 * Override pengirim email (khusus untuk unit/integration testing)
 */
export function setEmailSenderForTest(senderFn) {
  customEmailSender = typeof senderFn === 'function' ? senderFn : null;
}

/**
 * Kirim email transaksional melalui Resend REST API
 */
export async function sendEmail(
  { to, subject, html, text, replyTo },
  options = {}
) {
  if (customEmailSender && !options.bypassTestMock) {
    return customEmailSender({ to, subject, html, text, replyTo });
  }

  const apiKey = options.apiKey ?? config.email.resendApiKey;
  const from = options.from ?? config.email.from;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!apiKey) {
    throw new AppError(
      'Layanan email Resend belum dikonfigurasi (RESEND_API_KEY belum diisi)',
      503
    );
  }

  const recipients = Array.isArray(to) ? to : [to];
  const payload = {
    from,
    to: recipients,
    subject,
    html,
  };
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetchImpl(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const bodyText = await response.text().catch(() => '');
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const reason = parsed?.message || parsed?.name || `HTTP ${response.status}`;
    throw new AppError(`Gagal mengirim email melalui Resend: ${reason}`, 502);
  }

  return parsed || { id: null };
}
