import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound, Conflict, Forbidden } from '../../utils/errors.js';

const EXCLUDED_PETTY_CATEGORIES = new Set(['piutang', 'kulakan', 'retur_kulakan']);

function toWibDate(isoDate) {
  const dt = isoDate ? new Date(isoDate) : new Date();
  return new Date(dt.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Hitung kas kecil masuk & keluar laci selama shift kasir berlangsung
 */
export async function computeShiftPettyCash(shift) {
  if (!shift) return { totalMasuk: 0, totalKeluar: 0 };

  const startDate = toWibDate(shift.buka_pada);
  const endDate = shift.tutup_pada ? toWibDate(shift.tutup_pada) : toWibDate();

  let query = supabaseAdmin
    .from('arus_kas')
    .select('tipe, kategori, nominal, ref_id')
    .eq('toko_id', shift.toko_id)
    .gte('tgl_kas', startDate)
    .lte('tgl_kas', endDate);

  if (shift.kasir_id) {
    query = query.eq('kasir_id', shift.kasir_id);
  }

  const { data: rows, error } = await query;
  if (error || !rows) return { totalMasuk: 0, totalKeluar: 0 };

  let totalMasuk = 0;
  let totalKeluar = 0;

  for (const r of rows) {
    if (EXCLUDED_PETTY_CATEGORIES.has(r.kategori)) continue;
    // Bila terikat ke shift lain, lewati
    if (r.ref_id && r.ref_id !== shift.id) continue;
    const nom = Number(r.nominal || 0);
    if (r.tipe === 'masuk') totalMasuk += nom;
    else if (r.tipe === 'keluar') totalKeluar += nom;
  }

  return { totalMasuk, totalKeluar };
}

export function formatShiftRow(shift, pettyCash = null) {
  if (!shift) return null;
  const totalKasMasuk = pettyCash ? pettyCash.totalMasuk : Number(shift.total_kas_masuk || 0);
  const totalKasKeluar = pettyCash ? pettyCash.totalKeluar : Number(shift.total_kas_keluar || 0);

  return {
    ...shift,
    waktu_buka: shift.buka_pada,
    waktu_tutup: shift.tutup_pada,
    modal_awal: shift.kas_awal,
    total_penjualan_tunai: shift.total_tunai,
    total_penjualan_non_tunai: shift.total_qris,
    total_kas_masuk: totalKasMasuk,
    total_kas_keluar: totalKasKeluar,
    uang_fisik_akhir: shift.kas_fisik,
    selisih_kas: shift.selisih,
    status: shift.status === 'buka' ? 'terbuka' : 'tertutup',
    status_db: shift.status,
  };
}

/**
 * Buka Shift Baru Kasir
 */
export async function bukaShift(tokoId, kasirId, payload = {}) {
  const nomorShift = Number(payload.nomor_shift) || 1;
  const kasAwal = Number(payload.modal_awal ?? payload.kas_awal ?? 0);
  if (!Number.isFinite(kasAwal) || kasAwal < 0) {
    throw new BadRequest('Modal awal laci tidak valid atau bernilai negatif');
  }
  const catatanBuka = payload.catatan_buka || payload.catatan || null;

  const { data: shiftAktif } = await supabaseAdmin
    .from('shift_kasir')
    .select('id, nomor_shift, buka_pada')
    .eq('toko_id', tokoId)
    .eq('kasir_id', kasirId)
    .eq('status', 'buka')
    .maybeSingle();

  if (shiftAktif) {
    throw new Conflict(`Kasir masih memiliki shift aktif (#${shiftAktif.nomor_shift}) yang belum ditutup`);
  }

  const { data, error } = await supabaseAdmin
    .from('shift_kasir')
    .insert({
      toko_id: tokoId,
      kasir_id: kasirId,
      nomor_shift: nomorShift,
      buka_pada: new Date().toISOString(),
      status: 'buka',
      kas_awal: kasAwal,
      kas_sistem: kasAwal,
      total_transaksi: 0,
      total_tunai: 0,
      total_qris: 0,
      total_split: 0,
      total_bon: 0,
      catatan_selisih: catatanBuka,
    })
    .select('*, kasir:kasir_id(id, nama_lengkap, email)')
    .single();

  if (error) throw error;

  return formatShiftRow(data, { totalMasuk: 0, totalKeluar: 0 });
}

/**
 * Cek Shift Kasir yang Sedang Aktif
 */
export async function getShiftAktif(tokoId, kasirId) {
  if (!tokoId) return null;
  let query = supabaseAdmin
    .from('shift_kasir')
    .select('*, kasir:kasir_id(id, nama_lengkap, email)')
    .eq('toko_id', tokoId)
    .eq('status', 'buka');

  if (kasirId) {
    query = query.eq('kasir_id', kasirId);
  }

  const { data, error } = await query
    .order('buka_pada', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const pettyCash = await computeShiftPettyCash(data);
  return formatShiftRow(data, pettyCash);
}

/**
 * Tutup Shift & Audit Uang Laci Fisik (Memperhitungkan Arus Kas Masuk/Keluar Shift)
 */
export async function tutupShift(
  tokoId,
  kasirId,
  shiftId,
  payload = {},
  { enforceOwnShift = false } = {}
) {
  const uangFisikInput = payload.uang_fisik_akhir ?? payload.kas_fisik;
  const catatanTutup = payload.catatan_tutup ?? payload.catatan_selisih ?? null;

  if (uangFisikInput === undefined || uangFisikInput === null) {
    throw new BadRequest('Nominal kas fisik di laci kasir wajib diinput');
  }

  const uangFisik = Number(uangFisikInput);
  if (!Number.isFinite(uangFisik) || uangFisik < 0) {
    throw new BadRequest('Nominal kas fisik tidak valid atau tidak boleh negatif');
  }

  const { data: shift, error: findErr } = await supabaseAdmin
    .from('shift_kasir')
    .select('*')
    .eq('id', shiftId)
    .eq('toko_id', tokoId)
    .eq('status', 'buka')
    .maybeSingle();

  if (findErr) throw findErr;
  if (!shift) {
    throw new NotFound('Shift tidak ditemukan atau sudah ditutup');
  }

  if (enforceOwnShift && kasirId && shift.kasir_id !== kasirId) {
    throw new Forbidden('Kasir tidak diizinkan menutup sesi shift milik kasir lain');
  }

  const pettyCash = await computeShiftPettyCash(shift);
  const kasAwal = Number(shift.kas_awal || 0);
  const totalTunai = Number(shift.total_tunai || 0);
  const kasSistem = Math.max(0, kasAwal + totalTunai + pettyCash.totalMasuk - pettyCash.totalKeluar);
  const selisih = uangFisik - kasSistem;

  const { data: updatedShift, error: updateErr } = await supabaseAdmin
    .from('shift_kasir')
    .update({
      status: 'tutup',
      tutup_pada: new Date().toISOString(),
      kas_sistem: kasSistem,
      kas_fisik: uangFisik,
      selisih: selisih,
      catatan_selisih: catatanTutup,
    })
    .eq('id', shiftId)
    .eq('toko_id', tokoId)
    .eq('status', 'buka')
    .select('*, kasir:kasir_id(id, nama_lengkap, email)')
    .maybeSingle();

  if (updateErr) throw updateErr;
  if (!updatedShift) {
    throw new Conflict('Shift sudah ditutup oleh proses lain');
  }

  const formatted = formatShiftRow(updatedShift, pettyCash);

  return {
    ...formatted,
    ringkasan_audit: {
      kas_awal: kasAwal,
      total_penerimaan_tunai: totalTunai,
      total_kas_masuk: pettyCash.totalMasuk,
      total_kas_keluar: pettyCash.totalKeluar,
      seharusnya_di_laci: kasSistem,
      dihitung_fisik: uangFisik,
      selisih: selisih,
      status_selisih: selisih === 0 ? 'pas' : (selisih > 0 ? 'lebih' : 'kurang'),
    },
  };
}
