import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const { scanBarcode } = await import('../src/services/produk/scan.js');
const { getRiwayatTransaksi, getDetailTransaksi, incrementCetakStruk } = await import('../src/services/transaksi/riwayat.js');
const { getDashboardOwner } = await import('../src/services/laporan/dashboard.js');
const { getLaporanPenjualan } = await import('../src/services/laporan/penjualan.js');
const { catatLogInferensi } = await import('../src/services/ai/inferensi.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

describe('Phase 2 Runtime Fixes & Tenant Isolation', () => {
  it('Rejects missing tokoId across scan, riwayat, dashboard, penjualan, and inferensi without cross-tenant .limit(1) fallback', async () => {
    await assert.rejects(() => scanBarcode(null, '899123'), (e) => e.statusCode === 400);
    await assert.rejects(() => getRiwayatTransaksi(null, {}), (e) => e.statusCode === 400);
    await assert.rejects(() => getDetailTransaksi(null, 'tx-1'), (e) => e.statusCode === 400);
    await assert.rejects(() => incrementCetakStruk(null, 'tx-1'), (e) => e.statusCode === 400);
    await assert.rejects(() => getDashboardOwner(null), (e) => e.statusCode === 400);
    await assert.rejects(() => getLaporanPenjualan(null, {}), (e) => e.statusCode === 400);
    await assert.rejects(() => catatLogInferensi(null, 'u-1', { prediksi_kelas_id: 'k-1', skor_yakin: 0.9 }), (e) => e.statusCode === 400);
    await assert.rejects(() => catatLogInferensi('t-1', 'u-1', { skor_yakin: 0.9 }), (e) => e.statusCode === 400);
  });

  it('GET transaction detail never mutates cetak_ke in Supabase', async () => {
    const originalFrom = supabaseAdmin.from;
    let updatedTables = [];
    supabaseAdmin.from = (table) => {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        update() { updatedTables.push(table); return chain; },
        async maybeSingle() {
          return {
            data: { id: 'tx-1', no_transaksi: 'INV-1', metode_bayar: 'tunai', total: 10000, uang_diterima: 10000 },
            error: null,
          };
        },
        then(resolve) {
          return Promise.resolve({ data: [{ id: 'det-1', nama_produk: 'Air', jumlah: 1, harga_satuan: 10000, subtotal: 10000 }], error: null }).then(resolve);
        },
      };
      return chain;
    };

    try {
      const res = await getDetailTransaksi('toko-1', 'tx-1');
      assert.equal(res.nomor_faktur, 'INV-1');
      assert.deepEqual(updatedTables, []);
    } finally {
      supabaseAdmin.from = originalFrom;
    }
  });
});
