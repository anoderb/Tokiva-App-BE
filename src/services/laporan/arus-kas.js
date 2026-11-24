import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';

/**
 * Daftar Catatan Buku Kas (Arus Kas Masuk & Keluar)
 */
export async function listArusKas(tokoId, queryParams = {}) {
  const { tipe, jenis, kategori, tanggal_awal, tanggal_akhir, limit = 50, page = 1 } = queryParams;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('arus_kas')
    .select(`
      *,
      kasir:kasir_id(id, nama_lengkap)
    `, { count: 'exact' });

  if (tokoId) {
    query = query.eq('toko_id', tokoId);
  }

  const effectiveTipe = tipe || jenis;
  if (effectiveTipe) {
    query = query.eq('tipe', effectiveTipe);
  }

  if (kategori) {
    query = query.eq('kategori', kategori);
  }

  if (tanggal_awal) {
    query = query.gte('tgl_kas', tanggal_awal);
  }

  if (tanggal_akhir) {
    query = query.lte('tgl_kas', tanggal_akhir);
  }

  const { data, count, error } = await query
    .order('tgl_kas', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }

  const formattedItems = (data || []).map(row => ({
    ...row,
    jenis: row.tipe,
    keterangan: row.catatan,
    waktu: row.tgl_kas,
    referensi_id: row.ref_id,
  }));

  return {
    items: formattedItems,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Tambah Entri Arus Kas Manual (Operasional, Listrik, Sampah, Kas Masuk Lain)
 */
export async function tambahArusKas(tokoId, kasirId, payload = {}) {
  const tipe = payload.tipe || payload.jenis;
  const kategori = payload.kategori;
  const nominal = payload.nominal;
  const tgl_kas = payload.tgl_kas || payload.waktu || new Date().toISOString().slice(0, 10);
  const foto_nota = payload.foto_nota || null;
  const ref_id = payload.shift_id || payload.ref_id || null;
  const catatan = payload.catatan || payload.keterangan || null;

  if (!tipe || !['masuk', 'keluar'].includes(tipe)) {
    throw new BadRequest("Tipe arus kas harus 'masuk' atau 'keluar'");
  }

  if (!kategori) {
    throw new BadRequest('Kategori arus kas wajib diisi');
  }

  const numNominal = Number(nominal);
  if (!Number.isFinite(numNominal) || numNominal <= 0) {
    throw new BadRequest('Nominal kas harus lebih besar dari 0');
  }

  const { data, error } = await supabaseAdmin
    .from('arus_kas')
    .insert({
      toko_id: tokoId,
      kasir_id: kasirId,
      tipe: tipe,
      kategori: kategori,
      nominal: numNominal,
      tgl_kas: tgl_kas,
      ref_id: ref_id,
      foto_nota: foto_nota || null,
      catatan: catatan || null,
    })
    .select('*, kasir:kasir_id(id, nama_lengkap)')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Ringkasan Arus Kas Masuk, Keluar, dan Saldo Bersih
 */
export async function getRingkasanArusKas(tokoId, { bulan, tahun }) {
  const now = new Date();
  const targetYear = tahun ? Number(tahun) : now.getFullYear();
  const targetMonth = bulan ? Number(bulan) : now.getMonth() + 1;

  // Format tanggal awal dan akhir bulan
  const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  const endDay = new Date(targetYear, targetMonth, 0).getDate();
  const endDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  const { data, error } = await supabaseAdmin
    .from('arus_kas')
    .select('tipe, kategori, nominal')
    .eq('toko_id', tokoId)
    .gte('tgl_kas', startDate)
    .lte('tgl_kas', endDate);

  if (error) {
    throw error;
  }

  let totalMasuk = 0;
  let totalKeluar = 0;
  const breakdownKategori = {};

  for (const item of (data || [])) {
    const nom = Number(item.nominal || 0);
    if (item.tipe === 'masuk') {
      totalMasuk += nom;
    } else if (item.tipe === 'keluar') {
      totalKeluar += nom;
    }

    const key = `${item.tipe}_${item.kategori}`;
    breakdownKategori[key] = (breakdownKategori[key] || 0) + nom;
  }

  return {
    periode: {
      bulan: targetMonth,
      tahun: targetYear,
      dari: startDate,
      sampai: endDate,
    },
    total_masuk: totalMasuk,
    total_keluar: totalKeluar,
    saldo_bersih: totalMasuk - totalKeluar,
    breakdown: breakdownKategori,
  };
}

