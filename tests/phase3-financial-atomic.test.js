import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const { checkoutTransaksi } = await import('../src/services/transaksi/checkout.js');
const { voidTransaksi } = await import('../src/services/transaksi/void.js');
const { getRiwayatTransaksi } = await import('../src/services/transaksi/riwayat.js');
const { bayarPiutang } = await import('../src/services/pelanggan/piutang.js');
const { listPelanggan } = await import('../src/services/pelanggan/pelanggan.js');
const { parseReturCurrencyValue, returKulakan } = await import('../src/services/kulakan/kulakan-retur.js');
const { computeShiftPettyCash } = await import('../src/services/shift/buka-tutup.js');
const { getRingkasanShift } = await import('../src/services/shift/ringkasan.js');
const { applyAggregatedStockBatch } = await import('../src/utils/atomic-db.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

function createQueryChain(handler) {
  const ctx = {
    op: 'select',
    payload: null,
    filters: [],
    neqs: [],
    ins: [],
    rangeArgs: null,
  };
  const chain = {
    select() { return chain; },
    eq(col, val) { ctx.filters.push([col, val]); return chain; },
    neq(col, val) { ctx.neqs.push([col, val]); return chain; },
    in(col, vals) { ctx.ins.push([col, vals]); return chain; },
    gte() { return chain; },
    lte() { return chain; },
    or() { return chain; },
    order() { return chain; },
    range(from, to) { ctx.rangeArgs = [from, to]; return chain; },
    update(data) { ctx.op = 'update'; ctx.payload = data; return chain; },
    insert(data) { ctx.op = 'insert'; ctx.payload = data; return chain; },
    delete() { ctx.op = 'delete'; return chain; },
    async maybeSingle() { return handler({ ...ctx, terminal: 'maybeSingle' }); },
    async single() { return handler({ ...ctx, terminal: 'single' }); },
    then(resolve, reject) {
      return Promise.resolve(handler({ ...ctx, terminal: 'then' })).then(resolve, reject);
    },
  };
  return chain;
}

describe('Phase 3 Concurrency, Atomic DB, Accounting & Tenant Accuracy', () => {
  it('Checkout blocks negative monetary input and aggregates duplicate produk_id stock requirements', async () => {
    await assert.rejects(
      () => checkoutTransaksi('toko-1', 'kasir-1', {
        metode_bayar: 'tunai',
        uang_diterima: -5000,
        items: [{ produk_id: 'prod-1', jumlah: 1 }],
      }),
      (e) => e.statusCode === 400
    );

    const origFrom = supabaseAdmin.from;
    supabaseAdmin.from = (table) =>
      createQueryChain(async () => {
        if (table === 'produk') {
          return {
            data: [{
              id: 'prod-1',
              nama: 'Indomie Goreng',
              barcode: '8991',
              satuan_dasar: 'pcs',
              harga_jual: 3500,
              harga_modal: 2800,
              stok: 8,
              aktif: true,
              produk_satuan: [{ id: 'sat-dus', nama_satuan: 'Dus', isi_konversi: 10, harga_jual: 33000, aktif: true }],
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      });

    try {
      await assert.rejects(
        () => checkoutTransaksi('toko-1', 'kasir-1', {
          shift_id: 'shift-1',
          metode_bayar: 'tunai',
          uang_diterima: 50000,
          items: [
            { produk_id: 'prod-1', jumlah: 1, satuan_id: null },
            { produk_id: 'prod-1', jumlah: 1, satuan_id: 'sat-dus' },
          ],
        }),
        (e) => e.statusCode === 400 && e.message.includes('Total dibutuhkan: 11')
      );
    } finally {
      supabaseAdmin.from = origFrom;
    }
  });

  it('applyAggregatedStockBatch rolls back prior stock deductions when a later item fails', async () => {
    const origFrom = supabaseAdmin.from;
    const origRpc = supabaseAdmin.rpc;
    const rpcCalls = [];

    supabaseAdmin.rpc = async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === 'adjust_produk_stok_atomic' && args.p_produk_id === 'prod-2' && args.p_delta < 0) {
        return { data: null, error: { code: 'P0001', message: 'Stok Produk 2 tidak mencukupi' } };
      }
      return {
        data: [{ stok_sebelum: 10, stok_sesudah: 10 + Number(args.p_delta) }],
        error: null,
      };
    };
    supabaseAdmin.from = () => createQueryChain(async () => ({ data: null, error: null }));

    try {
      await assert.rejects(
        () => applyAggregatedStockBatch('toko-1', [
          { produk_id: 'prod-1', delta: -3, jenis: 'penjualan', ref_id: 'tx-1' },
          { produk_id: 'prod-2', delta: -5, jenis: 'penjualan', ref_id: 'tx-1' },
        ]),
        (e) => e.statusCode === 400
      );
      assert.equal(rpcCalls.length, 3);
      assert.equal(rpcCalls[2].args.p_produk_id, 'prod-1');
      assert.equal(rpcCalls[2].args.p_delta, 3);
    } finally {
      supabaseAdmin.from = origFrom;
      supabaseAdmin.rpc = origRpc;
    }
  });

  it('Void blocks double-void race atomically and reverses only remaining sisa_bon & accurate shift counters', async () => {
    const origFrom = supabaseAdmin.from;
    const origRpc = supabaseAdmin.rpc;
    const rpcCalls = [];

    // Case A: parallel race loses atomic status claim
    supabaseAdmin.rpc = async () => ({ data: [], error: null });
    supabaseAdmin.from = (table) =>
      createQueryChain(async (ctx) => {
        if (table === 'transaksi' && ctx.op === 'select') {
          return {
            data: {
              id: 'tx-race',
              no_transaksi: 'INV-RACE',
              status: 'selesai',
              shift_id: 'shift-1',
              kasir_id: 'kasir-1',
              total: 50000,
              uang_diterima: 50000,
              kembalian: 0,
              metode_bayar: 'tunai',
            },
            error: null,
          };
        }
        if (table === 'transaksi' && ctx.op === 'update') {
          return { data: null, error: null }; // lost atomic race
        }
        throw new Error(`Unexpected query on ${table} (${ctx.op}) during lost double-void race`);
      });

    try {
      await assert.rejects(
        () => voidTransaksi('toko-1', 'tx-race', { alasan: 'Salah', actor_peran: 'owner' }),
        (e) => e.statusCode === 400 && e.message.includes('sudah dibatalkan oleh proses lain')
      );

      // Case B: bon transaction partially paid (total 100k, DP 20k, sisa_bon 50k remaining)
      supabaseAdmin.rpc = async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === 'adjust_produk_stok_atomic') {
          return { data: [{ stok_sebelum: 5, stok_sesudah: 7 }], error: null };
        }
        if (fn === 'adjust_pelanggan_piutang_atomic') {
          return { data: [{ piutang_sesudah: 0 }], error: null };
        }
        if (fn === 'adjust_shift_counters_atomic') {
          return { data: [args], error: null };
        }
        return { data: null, error: null };
      };

      supabaseAdmin.from = (table) =>
        createQueryChain(async (ctx) => {
          if (table === 'transaksi' && ctx.op === 'select') {
            return {
              data: {
                id: 'tx-bon-1',
                no_transaksi: 'INV-BON-1',
                status: 'selesai',
                shift_id: 'shift-1',
                kasir_id: 'kasir-1',
                total: 100000,
                uang_diterima: 20000,
                kembalian: 0,
                metode_bayar: 'bon',
                pelanggan_id: 'pel-1',
              },
              error: null,
            };
          }
          if (table === 'transaksi' && ctx.op === 'update') {
            return { data: { id: 'tx-bon-1', status: 'batal' }, error: null };
          }
          if (table === 'transaksi_detail') {
            return { data: [{ produk_id: 'prod-1', jumlah: 2, isi_konversi: 1 }], error: null };
          }
          if (table === 'piutang' && ctx.op === 'select') {
            return { data: [{ id: 'pt-1', sisa_bon: 50000, status: 'belum_lunas' }], error: null };
          }
          if (table === 'piutang' && ctx.op === 'update') {
            return { data: [{ id: 'pt-1', status: 'batal', sisa_bon: 0 }], error: null };
          }
          return { data: null, error: null };
        });

      const res = await voidTransaksi('toko-1', 'tx-bon-1', { alasan: 'Batal nota', actor_peran: 'owner' });
      assert.equal(res.piutang_dibatalkan, 50000);

      const piutangRpc = rpcCalls.find((c) => c.fn === 'adjust_pelanggan_piutang_atomic');
      assert.equal(piutangRpc.args.p_delta, -50000);

      const shiftRpc = rpcCalls.find((c) => c.fn === 'adjust_shift_counters_atomic');
      assert.equal(shiftRpc.args.p_delta_transaksi, -1);
      assert.equal(shiftRpc.args.p_delta_bon, -50000);
      assert.equal(shiftRpc.args.p_delta_tunai, -20000);
    } finally {
      supabaseAdmin.from = origFrom;
      supabaseAdmin.rpc = origRpc;
    }
  });

  it('Piutang payment rejects batal bills and skips shift cash update on transfer method', async () => {
    const origFrom = supabaseAdmin.from;
    const origRpc = supabaseAdmin.rpc;
    const rpcCalls = [];

    supabaseAdmin.rpc = async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: [{ piutang_sesudah: 40000 }], error: null };
    };

    try {
      // Single payment on 'batal' piutang
      supabaseAdmin.from = () =>
        createQueryChain(async () => ({
          data: { id: 'pt-batal', status: 'batal', sisa_bon: 0, pelanggan: { id: 'pel-1', total_piutang: 0 } },
          error: null,
        }));

      await assert.rejects(
        () => bayarPiutang('toko-1', 'kasir-1', { piutang_id: 'pt-batal', nominal_bayar: 10000 }),
        (e) => e.statusCode === 400 && e.message.includes('dibatalkan')
      );

      // FIFO payment via transfer verifies .neq('status', 'batal') and skips shift update
      let sawBatalFilter = false;
      supabaseAdmin.from = (table) =>
        createQueryChain(async (ctx) => {
          if (table === 'pelanggan') {
            return { data: { id: 'pel-1', nama: 'Budi', total_piutang: 60000 }, error: null };
          }
          if (table === 'piutang' && ctx.op === 'select') {
            sawBatalFilter = ctx.neqs.some(([c, v]) => c === 'status' && v === 'batal');
            return {
              data: [{ id: 'pt-aktif', sisa_bon: 60000, terbayar: 0, status: 'belum_lunas' }],
              error: null,
            };
          }
          if (table === 'piutang' && ctx.op === 'update') {
            return { data: { id: 'pt-aktif' }, error: null };
          }
          if (table === 'piutang_bayar' && ctx.op === 'insert') {
            return { data: { id: 'pb-1', nominal_bayar: 20000 }, error: null };
          }
          return { data: null, error: null };
        });

      const res = await bayarPiutang('toko-1', 'kasir-1', {
        pelanggan_id: 'pel-1',
        nominal_bayar: 20000,
        metode: 'transfer',
        shift_id: 'shift-1',
      });
      assert.equal(sawBatalFilter, true);
      assert.equal(res.nominal_dibayar, 20000);
      assert.equal(
        rpcCalls.some((c) => c.fn === 'adjust_shift_counters_atomic'),
        false
      );
    } finally {
      supabaseAdmin.from = origFrom;
      supabaseAdmin.rpc = origRpc;
    }
  });

  it('Kulakan retur parses decimal strings accurately and blocks cash refund exceeding effectivePaid', async () => {
    assert.equal(parseReturCurrencyValue('Nilai: Rp150.000,00'), 150000);
    assert.equal(parseReturCurrencyValue('Rp25000.00'), 25000);
    assert.equal(parseReturCurrencyValue('Rp12.500'), 12500);

    const origFrom = supabaseAdmin.from;
    supabaseAdmin.from = (table) =>
      createQueryChain(async () => {
        if (table === 'kulakan') {
          return { data: { id: 'kul-1', no_faktur: 'KUL-1', total_beli: 100000, lunas: false }, error: null };
        }
        if (table === 'kulakan_detail') {
          return {
            data: [{ id: 'det-1', produk_id: 'prod-1', nama_satuan: 'Dus', isi_konversi: 10, jumlah: 2, harga_satuan: 50000 }],
            error: null,
          };
        }
        if (table === 'produk') {
          return { data: [{ id: 'prod-1', nama: 'Kopi', stok: 25, satuan_dasar: 'pcs' }], error: null };
        }
        if (table === 'arus_kas') {
          return { data: [{ nominal: 30000 }], error: null }; // only 30k paid so far
        }
        return { data: null, error: null };
      });

    try {
      await assert.rejects(
        () => returKulakan('toko-1', 'owner-1', 'kul-1', {
          kompensasi: 'refund_tunai',
          items: [{ produk_id: 'prod-1', jumlah_retur: 1 }], // 50k > 30k effectivePaid
        }),
        (e) => e.statusCode === 400 && e.message.includes('melebihi nominal yang sudah dibayar')
      );
    } finally {
      supabaseAdmin.from = origFrom;
    }
  });

  it('Shift petty cash excludes piutang/kulakan categories and enforces kasir shift ownership', async () => {
    const origFrom = supabaseAdmin.from;
    supabaseAdmin.from = (table) =>
      createQueryChain(async () => {
        if (table === 'arus_kas') {
          return {
            data: [
              { tipe: 'masuk', kategori: 'modal_tambahan', nominal: 25000, ref_id: 'shift-1' },
              { tipe: 'keluar', kategori: 'operasional', nominal: 10000, ref_id: null },
              { tipe: 'masuk', kategori: 'piutang', nominal: 90000, ref_id: null },
              { tipe: 'keluar', kategori: 'kulakan', nominal: 150000, ref_id: 'kul-1' },
              { tipe: 'keluar', kategori: 'operasional', nominal: 50000, ref_id: 'shift-other' },
            ],
            error: null,
          };
        }
        if (table === 'shift_kasir') {
          return {
            data: { id: 'shift-1', toko_id: 'toko-1', kasir_id: 'kasir-A', status: 'buka' },
            error: null,
          };
        }
        return { data: null, error: null };
      });

    try {
      const petty = await computeShiftPettyCash({
        id: 'shift-1',
        toko_id: 'toko-1',
        kasir_id: 'kasir-A',
        buka_pada: '2026-11-24T01:00:00Z',
      });
      assert.deepEqual(petty, { totalMasuk: 25000, totalKeluar: 10000 });

      await assert.rejects(
        () => getRingkasanShift('toko-1', 'shift-1', 'kasir-B'),
        (e) => e.statusCode === 403
      );
    } finally {
      supabaseAdmin.from = origFrom;
    }
  });

  it('Pelanggan & Riwayat services compute store-wide ringkasan independent of pagination limit', async () => {
    const origFrom = supabaseAdmin.from;
    supabaseAdmin.from = (table) =>
      createQueryChain(async (ctx) => {
        if (table === 'pelanggan') {
          // Summary query requests range(0, 9999), paginated requests range(0, 0)
          if (ctx.rangeArgs && ctx.rangeArgs[1] === 9999) {
            return {
              data: [{ total_piutang: 50000 }, { total_piutang: 0 }, { total_piutang: 25000 }],
              error: null,
            };
          }
          return { data: [{ id: 'pel-1', nama: 'Adi', total_piutang: 50000 }], count: 3, error: null };
        }
        if (table === 'transaksi') {
          if (ctx.rangeArgs && ctx.rangeArgs[1] === 9999) {
            return {
              data: [
                { status: 'selesai', total: 40000, laba_kotor: 12000 },
                { status: 'selesai', total: 60000, laba_kotor: 18000 },
                { status: 'batal', total: 20000, laba_kotor: 5000 },
              ],
              error: null,
            };
          }
          return {
            data: [{ id: 'tx-1', no_transaksi: 'INV-1', metode_bayar: 'tunai', status: 'selesai', total: 40000 }],
            count: 3,
            error: null,
          };
        }
        return { data: null, error: null };
      });

    try {
      const pelRes = await listPelanggan('toko-1', { limit: 1, page: 1 });
      assert.equal(pelRes.items.length, 1);
      assert.deepEqual(pelRes.ringkasan, {
        total_pelanggan: 3,
        pelanggan_berutang: 2,
        total_piutang_aktif: 75000,
      });

      const txRes = await getRiwayatTransaksi('toko-1', { limit: 1, page: 1 });
      assert.equal(txRes.items.length, 1);
      assert.deepEqual(txRes.ringkasan, {
        total_faktur: 3,
        total_selesai: 2,
        total_batal: 1,
        total_omzet: 100000,
        total_laba_kotor: 30000,
      });
    } finally {
      supabaseAdmin.from = origFrom;
    }
  });
});
