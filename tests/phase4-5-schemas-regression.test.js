import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const { buildApp } = await import('../src/app.js');
const { kaggleService } = await import('../src/services/ai/kaggle.js');
const schedulerMod = await import('../src/services/ai/scheduler.js');
const huggingfaceMod = await import('../src/services/ai/huggingface.js');
const platformMod = await import('../src/services/admin/platform.js');
const kulakanReturMod = await import('../src/services/kulakan/kulakan-retur.js');
const katalogMod = await import('../src/services/produk/katalog.js');
const modelMod = await import('../src/services/ai/model.js');
const kelasMod = await import('../src/services/ai/kelas.js');
const sampelMod = await import('../src/services/ai/sampel.js');
const verificationMod = await import('../src/services/auth/verification.js');
const piutangMod = await import('../src/services/pelanggan/piutang.js');
const inferensiMod = await import('../src/services/ai/inferensi.js');
const kasirMod = await import('../src/services/pengguna/kasir.js');
const qrisMod = await import('../src/utils/qris-utils.js');

describe('Phase 4-5 Schemas, Modular Exports & Route Contracts', () => {
  it('All Fastify API routes register cleanly and enforce auth on role namespaces', async () => {
    const app = await buildApp();
    await app.ready();
    const tree = app.printRoutes({ commonPrefix: false });
    assert.ok(tree.includes('auth'));
    assert.ok(tree.includes('media'));

    const protectedProbes = [
      { method: 'GET', url: '/api/owner/produk' },
      { method: 'GET', url: '/api/kasir/shift/aktif' },
      { method: 'GET', url: '/api/admin/ai/model' },
      { method: 'GET', url: '/api/owner/toko' },
      { method: 'GET', url: '/api/kasir/toko/profil' },
    ];
    for (const probe of protectedProbes) {
      const res = await app.inject(probe);
      assert.equal(res.statusCode, 401, `${probe.method} ${probe.url} should enforce auth`);
    }

    const mediaBad = await app.inject({
      method: 'POST',
      url: '/api/owner/media/upload',
      payload: {},
    });
    assert.equal(mediaBad.statusCode, 401);

    await app.close();
  });

  it('Every Fastify route plugin registers routes with schema attached via onRoute capture', async () => {
    const Fastify = (await import('fastify')).default;
    const [
      { default: publicRoutes },
      { default: kasirRoutes },
      { default: ownerRoutes },
      { default: adminRoutes },
    ] = await Promise.all([
      import('../src/routes/public/index.js'),
      import('../src/routes/kasir/index.js'),
      import('../src/routes/owner/index.js'),
      import('../src/routes/admin/index.js'),
    ]);

    const app = Fastify({ logger: false });
    const captured = [];
    app.addHook('onRoute', (routeOptions) => {
      if (['HEAD', 'OPTIONS'].includes(routeOptions.method)) return;
      captured.push({
        method: routeOptions.method,
        url: routeOptions.url,
        hasSchema: Boolean(routeOptions.schema),
      });
    });

    await app.register(publicRoutes, { prefix: '/api' });
    await app.register(kasirRoutes, { prefix: '/api/kasir' });
    await app.register(ownerRoutes, { prefix: '/api/owner' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.ready();

    const missingSchema = captured.filter((r) => !r.hasSchema);
    assert.deepEqual(
      missingSchema,
      [],
      `Expected every registered route to define JSON schema, found missing: ${JSON.stringify(missingSchema)}`
    );
    assert.ok(captured.length > 50, `Expected >50 registered routes, got ${captured.length}`);
    await app.close();
  });

  it('Modularized backend service facades preserve all expected public exports', () => {
    for (const fn of [
      'getDatasetInfo',
      'triggerDatasetSync',
      'triggerTraining',
      'downloadAndRegister',
      'fetchAndRegisterKaggleOutput',
      'getResearchSummary',
    ]) {
      assert.equal(typeof kaggleService[fn], 'function', `kaggleService.${fn} missing`);
    }
    for (const fn of [
      'initAiAutomationScheduler',
      'stopAiAutomationScheduler',
      'reloadSchedules',
      'getSchedulerStatus',
      'runDatasetSyncCheck',
      'runTrainingCheck',
      'handleExternalCronTick',
    ]) {
      assert.equal(typeof schedulerMod[fn], 'function', `scheduler.${fn} missing`);
    }
    for (const fn of [
      'syncDatasetToHuggingFace',
      'getDatasetStats',
      'deleteFilesFromHuggingFace',
      'deleteClassFolderFromHuggingFace',
      'moveFilesInHuggingFace',
    ]) {
      assert.equal(typeof huggingfaceMod[fn], 'function', `huggingface.${fn} missing`);
    }
    for (const fn of [
      'getDashboardAdmin',
      'listTokoPlatform',
      'getDetailTokoPlatform',
      'createTokoDanOwner',
      'updateStatusToko',
      'listPenggunaPlatform',
      'updateStatusPenggunaPlatform',
    ]) {
      assert.equal(typeof platformMod[fn], 'function', `platform.${fn} missing`);
    }
    for (const fn of ['parseReturCurrencyValue', 'parseReturMutasiRow', 'listReturKulakan', 'returKulakan']) {
      assert.equal(typeof kulakanReturMod[fn], 'function', `kulakanRetur.${fn} missing`);
    }
    for (const fn of ['listProdukKasir', 'listProdukOwner', 'getDetailProduk', 'createProduk', 'updateProduk', 'deleteProduk']) {
      assert.equal(typeof katalogMod[fn], 'function', `katalog.${fn} missing`);
    }
    for (const fn of [
      'getModelAktif',
      'listModels',
      'activateModel',
      'syncStorageModel',
      'registerManualModel',
      'getThresholdConfig',
      'updateThresholdConfig',
      'deleteModel',
    ]) {
      assert.equal(typeof modelMod[fn], 'function', `model.${fn} missing`);
    }
    for (const fn of ['listKelasAI', 'getDetailKelasAI', 'createKelasAI', 'updateKelasAI', 'updateTargetKelasAI', 'deleteKelasAI', 'listUnmappedProduk', 'mapProdukKeKelas']) {
      assert.equal(typeof kelasMod[fn], 'function', `kelas.${fn} missing`);
    }
    for (const fn of ['uploadBurstSampel', 'listSampel', 'verifikasiSampel', 'deleteSampelBatch', 'ubahKelasSampel']) {
      assert.equal(typeof sampelMod[fn], 'function', `sampel.${fn} missing`);
    }
    for (const fn of [
      'sendVerificationEmail',
      'verifyEmailAddress',
      'resendVerificationEmail',
      'requestPasswordReset',
      'resetPasswordWithToken',
      'sendKasirInviteEmail',
      'getKasirInviteDetails',
      'acceptKasirInvite',
    ]) {
      assert.equal(typeof verificationMod[fn], 'function', `verification.${fn} missing`);
    }
    for (const fn of ['listPiutang', 'getKartuPiutang', 'bayarPiutangFifo', 'bayarPiutang']) {
      assert.equal(typeof piutangMod[fn], 'function', `piutang.${fn} missing`);
    }
    for (const fn of ['catatLogInferensi', 'listLogInferensi', 'getRingkasanAkurasi', 'jadikanDataLatihDariLog']) {
      assert.equal(typeof inferensiMod[fn], 'function', `inferensi.${fn} missing`);
    }
    for (const fn of ['listKasir', 'getDetailKasir', 'createKasir', 'resendKasirInvite', 'updateKasir', 'resetPinKasir', 'deleteKasir']) {
      assert.equal(typeof kasirMod[fn], 'function', `kasir.${fn} missing`);
    }
    for (const fn of ['calculateCRC16', 'parseTLV', 'parseQRIS', 'validateQRIS', 'convertQRIS']) {
      assert.equal(typeof qrisMod[fn], 'function', `qrisUtils.${fn} missing`);
    }
  });
});
