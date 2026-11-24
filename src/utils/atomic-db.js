import { supabaseAdmin } from '../lib/supabase.js';
import { BadRequest, Conflict, NotFound } from './errors.js';

const MAX_CAS_RETRIES = 4;

function isMissingRpcError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

/**
 * Penyesuaian stok produk atomik menggunakan PostgreSQL RPC (FOR UPDATE),
 * dengan fallback optimistic CAS loop bila RPC migrasi belum dijalankan.
 */
export async function adjustProdukStokAtomic({
  tokoId,
  produkId,
  delta,
  jenis = 'penyesuaian',
  refId = null,
  catatan = null,
  allowNegative = false,
  hargaModalBaru = null,
}) {
  const numDelta = Number(delta || 0);

  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('adjust_produk_stok_atomic', {
    p_toko_id: tokoId,
    p_produk_id: produkId,
    p_delta: numDelta,
    p_jenis: jenis,
    p_ref_id: refId,
    p_catatan: catatan,
    p_allow_negative: Boolean(allowNegative),
  });

  if (!rpcErr && Array.isArray(rpcData) && rpcData[0]) {
    if (hargaModalBaru !== null && hargaModalBaru !== undefined) {
      await supabaseAdmin
        .from('produk')
        .update({ harga_modal: Number(hargaModalBaru), diubah_pada: new Date().toISOString() })
        .eq('id', produkId)
        .eq('toko_id', tokoId);
    }
    return {
      produk_id: produkId,
      stok_sebelum: Number(rpcData[0].stok_sebelum),
      stok_sesudah: Number(rpcData[0].stok_sesudah),
    };
  }

  if (rpcErr && !isMissingRpcError(rpcErr)) {
    if (rpcErr.code === 'P0001' || String(rpcErr.message || '').toLowerCase().includes('tidak mencukupi')) {
      throw new BadRequest(rpcErr.message);
    }
    if (rpcErr.code === 'P0002') {
      throw new NotFound(rpcErr.message);
    }
    throw rpcErr;
  }

  // Fallback CAS retry loop apabila fungsi RPC SQL belum diterapkan
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { data: prod, error: fetchErr } = await supabaseAdmin
      .from('produk')
      .select('id, nama, satuan_dasar, stok')
      .eq('id', produkId)
      .eq('toko_id', tokoId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!prod) throw new NotFound(`Produk '${produkId}' tidak ditemukan di toko ini`);

    const stokSebelum = Number(prod.stok || 0);
    let stokSesudah = stokSebelum + numDelta;

    if (!allowNegative && stokSesudah < 0) {
      throw new BadRequest(
        `Stok '${prod.nama}' tidak mencukupi (Tersedia: ${stokSebelum} ${prod.satuan_dasar}, Dibutuhkan: ${Math.abs(numDelta)} ${prod.satuan_dasar})`
      );
    }
    if (allowNegative && stokSesudah < 0) {
      stokSesudah = 0;
    }

    const updatePayload = {
      stok: stokSesudah,
      diubah_pada: new Date().toISOString(),
    };
    if (hargaModalBaru !== null && hargaModalBaru !== undefined) {
      updatePayload.harga_modal = Number(hargaModalBaru);
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('produk')
      .update(updatePayload)
      .eq('id', produkId)
      .eq('toko_id', tokoId)
      .eq('stok', prod.stok)
      .select('id, stok')
      .maybeSingle();

    if (updErr) throw updErr;

    if (updated) {
      const { error: mutErr } = await supabaseAdmin.from('mutasi_stok').insert({
        toko_id: tokoId,
        produk_id: produkId,
        jenis,
        ref_id: refId,
        perubahan: numDelta,
        stok_sebelum: stokSebelum,
        stok_sesudah: stokSesudah,
        catatan,
      });
      if (mutErr) throw mutErr;

      return {
        produk_id: produkId,
        stok_sebelum: stokSebelum,
        stok_sesudah: stokSesudah,
      };
    }
  }

  throw new Conflict('Terjadi persaingan transaksi stok secara bersamaan. Silakan coba lagi.');
}

/**
 * Eksekusi batch perubahan stok yang sudah diagregasi per produk_id dengan kompensasi rollback bila gagal di tengah.
 */
export async function applyAggregatedStockBatch(tokoId, entries, { allowNegative = false } = {}) {
  const completed = [];
  try {
    for (const entry of entries) {
      const res = await adjustProdukStokAtomic({
        tokoId,
        produkId: entry.produk_id,
        delta: entry.delta,
        jenis: entry.jenis,
        refId: entry.ref_id || null,
        catatan: entry.catatan || null,
        allowNegative,
        hargaModalBaru: entry.harga_modal_baru ?? null,
      });
      completed.push({ entry, res });
    }
    return completed;
  } catch (err) {
    // Rollback perubahan stok sebelumnya apabila item berikutnya gagal
    for (const done of completed.reverse()) {
      await adjustProdukStokAtomic({
        tokoId,
        produkId: done.entry.produk_id,
        delta: -done.entry.delta,
        jenis: 'koreksi',
        refId: done.entry.ref_id || null,
        catatan: `Rollback otomatis transaksi gagal (${done.entry.jenis})`,
        allowNegative: true,
      }).catch(() => {});
    }
    throw err;
  }
}

/**
 * Penyesuaian total_piutang pelanggan secara atomik
 */
export async function adjustPelangganPiutangAtomic(tokoId, pelangganId, delta) {
  const numDelta = Number(delta || 0);
  if (!pelangganId || numDelta === 0) return null;

  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('adjust_pelanggan_piutang_atomic', {
    p_toko_id: tokoId,
    p_pelanggan_id: pelangganId,
    p_delta: numDelta,
  });

  if (!rpcErr && Array.isArray(rpcData) && rpcData[0]) {
    return Number(rpcData[0].piutang_sesudah);
  }
  if (rpcErr && !isMissingRpcError(rpcErr)) {
    throw rpcErr;
  }

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { data: pel, error: findErr } = await supabaseAdmin
      .from('pelanggan')
      .select('id, total_piutang')
      .eq('id', pelangganId)
      .eq('toko_id', tokoId)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!pel) return null;

    const current = Number(pel.total_piutang || 0);
    const next = Math.max(0, current + numDelta);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('pelanggan')
      .update({ total_piutang: next })
      .eq('id', pelangganId)
      .eq('toko_id', tokoId)
      .eq('total_piutang', pel.total_piutang)
      .select('total_piutang')
      .maybeSingle();

    if (updErr) throw updErr;
    if (updated) return Number(updated.total_piutang);
  }

  throw new Conflict('Konflik pembaruan piutang pelanggan. Silakan coba lagi.');
}

/**
 * Pembaruan akumulasi omzet shift_kasir secara atomik
 */
export async function adjustShiftCountersAtomic({
  tokoId,
  shiftId,
  deltaTransaksi = 0,
  deltaTunai = 0,
  deltaQris = 0,
  deltaSplit = 0,
  deltaBon = 0,
}) {
  if (!shiftId) return null;
  if (
    deltaTransaksi === 0 &&
    deltaTunai === 0 &&
    deltaQris === 0 &&
    deltaSplit === 0 &&
    deltaBon === 0
  ) {
    return null;
  }

  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('adjust_shift_counters_atomic', {
    p_toko_id: tokoId,
    p_shift_id: shiftId,
    p_delta_transaksi: Math.trunc(Number(deltaTransaksi || 0)),
    p_delta_tunai: Number(deltaTunai || 0),
    p_delta_qris: Number(deltaQris || 0),
    p_delta_split: Number(deltaSplit || 0),
    p_delta_bon: Number(deltaBon || 0),
  });

  if (!rpcErr && Array.isArray(rpcData) && rpcData[0]) {
    return rpcData[0];
  }
  if (rpcErr && !isMissingRpcError(rpcErr)) {
    throw rpcErr;
  }

  const { data: curShift } = await supabaseAdmin
    .from('shift_kasir')
    .select('id, total_transaksi, total_tunai, total_qris, total_split, total_bon')
    .eq('id', shiftId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (!curShift) return null;

  const updateShift = {
    total_transaksi: Math.max(0, Number(curShift.total_transaksi || 0) + Math.trunc(Number(deltaTransaksi || 0))),
    total_tunai: Math.max(0, Number(curShift.total_tunai || 0) + Number(deltaTunai || 0)),
    total_qris: Math.max(0, Number(curShift.total_qris || 0) + Number(deltaQris || 0)),
    total_split: Math.max(0, Number(curShift.total_split || 0) + Number(deltaSplit || 0)),
    total_bon: Math.max(0, Number(curShift.total_bon || 0) + Number(deltaBon || 0)),
  };

  const { data: updated } = await supabaseAdmin
    .from('shift_kasir')
    .update(updateShift)
    .eq('id', shiftId)
    .eq('toko_id', tokoId)
    .select()
    .maybeSingle();

  return updated || updateShift;
}
