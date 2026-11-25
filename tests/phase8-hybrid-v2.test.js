import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

test('Phase 8 Hybrid AI v2 Track Isolation & Embedding Helpers', async (t) => {
  await t.test('getTrackConfig isolates v1 and v2 notebooks, kernels, state files, and dirs', async () => {
    const { getTrackConfig, normalizeTrack } = await import('../src/services/ai/kaggle-config.js');
    assert.equal(normalizeTrack(undefined), 'v1');
    assert.equal(normalizeTrack('v2'), 'v2');

    const v1 = getTrackConfig('v1');
    const v2 = getTrackConfig('v2');
    assert.notEqual(v1.notebookPath, v2.notebookPath);
    assert.notEqual(v1.kernelSlug, v2.kernelSlug);
    assert.notEqual(v1.pushDir, v2.pushDir);
    assert.notEqual(v1.outputDir, v2.outputDir);
    assert.notEqual(v1.stateFile, v2.stateFile);
    assert.notEqual(v1.cloudStatePath, v2.cloudStatePath);
    assert.equal(v1.versionPrefix, 'v1');
    assert.equal(v2.versionPrefix, 'v2');
  });

  await t.test('normalizeConfig preserves target_track and defaults safely to v1', async () => {
    const { normalizeConfig } = await import('../src/services/ai/automation-store.js');
    const cfgDefault = normalizeConfig({});
    assert.equal(cfgDefault.training.target_track, 'v1');
    const cfgV2 = normalizeConfig({ training: { target_track: 'v2' } });
    assert.equal(cfgV2.training.target_track, 'v2');
    const cfgInvalid = normalizeConfig({ training: { target_track: 'v99' } });
    assert.equal(cfgInvalid.training.target_track, 'v1');
  });

  await t.test('l2NormalizeVector and validateEmbeddingPayload normalize to unit vector', async () => {
    const { l2NormalizeVector, validateEmbeddingPayload } = await import('../src/services/ai/embedding.js');
    const unit = l2NormalizeVector([3, 4]);
    assert.ok(Math.abs(unit[0] - 0.6) < 1e-5);
    assert.ok(Math.abs(unit[1] - 0.8) < 1e-5);

    const raw16 = Array.from({ length: 16 }, (_, idx) => (idx === 0 ? 3 : idx === 1 ? 4 : 0));
    const validated = validateEmbeddingPayload({ centroid: raw16, prototypes: [raw16] }, 16);
    assert.equal(validated.dimensi, 16);
    assert.equal(validated.embedding.prototypes.length, 1);
    assert.ok(Math.abs(validated.embedding.centroid[0] - 0.6) < 1e-5);
    assert.throws(() => validateEmbeddingPayload({ centroid: raw16 }, 256));
  });

  await t.test('v2 Kaggle notebook exists, is valid JSON, retains E1 & E2, and exports dual output', () => {
    const nbPath = path.resolve(process.cwd(), 'kaggle/model-training-v2-hybrid-embedding.ipynb');
    assert.ok(fs.existsSync(nbPath));
    const nb = JSON.parse(fs.readFileSync(nbPath, 'utf-8'));
    const allSrc = nb.cells.map((c) => (c.source || []).join('')).join('\n');
    assert.ok(allSrc.includes('E1_MobileNetV3'));
    assert.ok(allSrc.includes('E2_MobileNetV3_CBAM'));
    assert.ok(allSrc.includes('L2NormalizeLayer'));
    assert.ok(allSrc.includes('build_dual_output_model'));
    assert.ok(allSrc.includes('class_centroids.json'));
    assert.ok(allSrc.includes('embedding_meta.json'));
  });
});
