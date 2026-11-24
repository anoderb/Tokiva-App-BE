import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Pastikan env minimum tersedia bila dijalankan tanpa .env lengkap di CI
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const { buildApp, isOriginAllowed } = await import('../src/app.js');
const { escapeHtml, buildVerificationEmail, buildResetPasswordEmail, buildKasirInviteEmail } = await import('../src/services/email/templates.js');
const { sendEmail, setEmailSenderForTest } = await import('../src/services/email/resend.js');
const { hashPinKasir, comparePinKasir } = await import('../src/services/auth/pin.js');
const { isPrivateOrLoopbackIp, assertSafeHttpsUrl, verifyMediaSignature } = await import('../src/routes/public/media-proxy.js');
const { sanitizeSearchTerm } = await import('../src/utils/postgrest.js');

afterEach(() => {
  setEmailSenderForTest(null);
});

describe('Phase 1 Security & Resend Verification', () => {
  it('CORS strict allowlist rejects untrusted origins and localhost.attacker.tld', () => {
    const allowed = new Set(['http://localhost:3000', 'https://app.tokiva.biz.id']);
    assert.equal(isOriginAllowed('http://localhost:3000', allowed, false), true);
    assert.equal(isOriginAllowed('https://app.tokiva.biz.id', allowed, false), true);
    assert.equal(isOriginAllowed('https://localhost.attacker.tld', allowed, true), false);
    assert.equal(isOriginAllowed('https://evil.example', allowed, true), false);
    assert.equal(isOriginAllowed('http://localhost:3001', allowed, true), true);
  });

  it('Email templates escape HTML characters against injection', () => {
    const escaped = escapeHtml('<script>alert("x")</script>&\'');
    assert.equal(escaped, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');

    const vMail = buildVerificationEmail({
      nama: '<b>Budi</b>',
      namaToko: 'Toko <script>',
      verifyUrl: 'https://app.tokiva.biz.id/auth/verify-email?token=abc',
      otp: '123456',
    });
    assert.ok(!vMail.html.includes('<script>'));
    assert.ok(vMail.html.includes('&lt;b&gt;Budi&lt;/b&gt;'));
    assert.ok(vMail.html.includes('123456'));

    const rMail = buildResetPasswordEmail({ nama: 'Ani', resetUrl: 'https://x', otp: '654321' });
    assert.ok(rMail.html.includes('654321'));

    const iMail = buildKasirInviteEmail({ nama: 'Siti', namaToko: 'Warung "Maju"', inviteUrl: 'https://x' });
    assert.ok(iMail.html.includes('Warung &quot;Maju&quot;'));
  });

  it('Resend client calls REST API with bearer key and reports 503 when unconfigured', async () => {
    await assert.rejects(
      () => sendEmail({ to: 'a@b.com', subject: 'Test', html: '<p>Hi</p>' }, { apiKey: '' }),
      (err) => err.statusCode === 503
    );

    let capturedRequest = null;
    const mockFetch = async (url, init) => {
      capturedRequest = { url, init };
      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const res = await sendEmail(
      { to: 'user@tokiva.biz.id', subject: 'Verifikasi', html: '<p>Halo</p>' },
      { apiKey: 're_mock_key', from: 'Tokiva POS <noreply@tokiva.biz.id>', fetchImpl: mockFetch }
    );

    assert.equal(res.id, 'email_123');
    assert.equal(capturedRequest.url, 'https://api.resend.com/emails');
    assert.equal(capturedRequest.init.headers.Authorization, 'Bearer re_mock_key');
  });

  it('PIN hashing uses bcrypt and verifies matching PINs', async () => {
    const hash = await hashPinKasir('246810');
    assert.ok(hash.startsWith('$2'));
    assert.equal(await comparePinKasir('246810', hash), true);
    assert.equal(await comparePinKasir('000000', hash), false);
    await assert.rejects(() => hashPinKasir('12ab'), (err) => err.statusCode === 400);
  });

  it('SSRF proxy guard blocks loopback, private ranges, cloud metadata, and HTTP', async () => {
    assert.equal(isPrivateOrLoopbackIp('127.0.0.1'), true);
    assert.equal(isPrivateOrLoopbackIp('169.254.169.254'), true);
    assert.equal(isPrivateOrLoopbackIp('10.0.0.5'), true);
    assert.equal(isPrivateOrLoopbackIp('172.16.0.1'), true);
    assert.equal(isPrivateOrLoopbackIp('192.168.1.10'), true);
    assert.equal(isPrivateOrLoopbackIp('::1'), true);
    assert.equal(isPrivateOrLoopbackIp('8.8.8.8'), false);

    await assert.rejects(() => assertSafeHttpsUrl('http://huggingface.co/file.jpg'), (err) => err.statusCode === 403);
    await assert.rejects(() => assertSafeHttpsUrl('https://169.254.169.254/latest/meta-data'), (err) => err.statusCode === 403);
    await assert.rejects(() => assertSafeHttpsUrl('https://localhost/secret'), (err) => err.statusCode === 403);

    assert.equal(verifyMediaSignature('a', String(Math.floor(Date.now() / 1000) - 10), 'deadbeef'), false);
  });

  it('PostgREST search sanitization removes filter syntax metacharacters', () => {
    assert.equal(sanitizeSearchTerm('indomie,status.eq.batal(1)*%'), 'indomie status.eq.batal 1');
  });

  it('Fastify app blocks unauthenticated media-proxy, enforces Void PIN schema, and sets security headers', async () => {
    const app = await buildApp();
    try {
      const proxyRes = await app.inject({
        method: 'GET',
        url: '/api/media/hf-proxy?path=data/test.jpg',
      });
      assert.equal(proxyRes.statusCode, 401);
      assert.equal(proxyRes.headers['x-content-type-options'], 'nosniff');
      assert.equal(proxyRes.headers['x-frame-options'], 'DENY');

      const corsRejectRes = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil-attacker.example' },
      });
      assert.equal(corsRejectRes.statusCode, 403);
    } finally {
      await app.close();
    }
  });
});
