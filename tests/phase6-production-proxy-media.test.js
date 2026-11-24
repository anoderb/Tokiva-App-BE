import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const { buildApp, isOriginAllowed } = await import('../src/app.js');
const {
  buildSignedHfProxyPath,
  verifyMediaSignature,
} = await import('../src/routes/public/media-proxy.js');
const { config } = await import('../src/config/env.js');

describe('Phase 6 Production Proxy, Signed Media & Split-Domain Hardening', () => {
  it('buildSignedHfProxyPath generates valid signature and rejects tampered path/signature', () => {
    const rawPath = 'data/kelas A/sampel 1.jpg';
    const signedUrl = buildSignedHfProxyPath(rawPath, 300);
    assert.ok(signedUrl && signedUrl.startsWith('/api/media/hf-proxy?'));

    const parsed = new URL(`https://api.example.com${signedUrl}`);
    const decodedPath = parsed.searchParams.get('path');
    const exp = parsed.searchParams.get('exp');
    const sig = parsed.searchParams.get('sig');

    assert.equal(decodedPath, rawPath);
    assert.equal(verifyMediaSignature(decodedPath, exp, sig), true);
    assert.equal(verifyMediaSignature('data/kelas A/other.jpg', exp, sig), false);
    assert.equal(verifyMediaSignature(decodedPath, exp, '0'.repeat(64)), false);
  });

  it('buildApp rejects unauthenticated /api/media/research-plot and sets CORP same-site on normal API routes', async () => {
    const app = await buildApp();
    try {
      const resPlot = await app.inject({
        method: 'GET',
        url: '/api/media/research-plot?exp=E1_MobileNetV3&type=confusion_matrix&run_id=default',
      });
      assert.equal(resPlot.statusCode, 401);
      assert.equal(resPlot.headers['cross-origin-resource-policy'], 'same-site');

      const resHealth = await app.inject({
        method: 'GET',
        url: '/api/health',
      });
      assert.equal(resHealth.headers['cross-origin-resource-policy'], 'same-site');
    } finally {
      await app.close();
    }
  });

  it('isOriginAllowed permits configured production frontend origin and blocks foreign origins', () => {
    const allowed = new Set(['https://app.tokiva.biz.id', 'https://www.tokiva.biz.id']);
    assert.equal(isOriginAllowed('https://app.tokiva.biz.id', allowed, false), true);
    assert.equal(isOriginAllowed('https://www.tokiva.biz.id', allowed, false), true);
    assert.equal(isOriginAllowed('https://evil.tokiva.biz.id', allowed, false), false);
    assert.equal(isOriginAllowed('http://localhost:3000', allowed, false), false);
  });

  it('signed /api/media/hf-proxy returns 400 instead of 500 on malformed percent-encoded path', async () => {
    const prevRepo = config.huggingFace.datasetRepo;
    config.huggingFace.datasetRepo = 'org/dataset-test';
    const app = await buildApp();
    try {
      const malformedPath = '%E0%A4%A';
      const signedPath = buildSignedHfProxyPath(malformedPath, 300);
      const res = await app.inject({
        method: 'GET',
        url: signedPath,
      });
      assert.equal(res.statusCode, 400);
    } finally {
      config.huggingFace.datasetRepo = prevRepo;
      await app.close();
    }
  });
});
