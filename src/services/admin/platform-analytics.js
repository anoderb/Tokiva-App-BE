import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';

async function fetchAllRows(queryFactory, pageSize = 1000) {
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

/**
 * Ringkasan Dashboard Eksekutif Superadmin Platform
 */
export async function getDashboardAdmin() {
  const [
    stores,
    users,
    txs,
    masters,
    { data: kelasList, error: kelasErr },
    { data: activeModel, error: modelErr },
  ] = await Promise.all([
    fetchAllRows(() => supabaseAdmin.from('toko').select('*').order('dibuat_pada', { ascending: false })),
    fetchAllRows(() =>
      supabaseAdmin
        .from('pengguna')
        .select('id, toko_id, nama_lengkap, email, peran, aktif, dibuat_pada')
        .order('id', { ascending: true })
    ),
    fetchAllRows(() =>
      supabaseAdmin
        .from('transaksi')
        .select('id, toko_id, total, tgl_transaksi')
        .eq('status', 'selesai')
        .order('id', { ascending: true })
    ),
    fetchAllRows(() =>
      supabaseAdmin.from('produk_master').select('id, merek, kategori_id').order('id', { ascending: true })
    ),
    supabaseAdmin.from('ai_kelas').select('total_foto, jml_hf'),
    supabaseAdmin
      .from('ai_model')
      .select('versi, nama_model, arsitektur, akurasi_top1, latensi_ms, jml_kelas, ukuran_model_mb')
      .eq('aktif', true)
      .order('tgl_rilis', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (kelasErr) throw kelasErr;
  if (modelErr) throw modelErr;

  const totalToko = stores.length;
  const tokoAktif = stores.filter((t) => t.status === 'aktif').length;
  const totalPengguna = users.length;
  const totalOwner = users.filter((u) => u.peran === 'owner').length;
  const totalKasir = users.filter((u) => u.peran === 'kasir').length;
  const totalTransaksi = txs.length;
  const totalGmv = txs.reduce((sum, tx) => sum + Number(tx.total || 0), 0);
  const totalFotoAi = (kelasList || []).reduce((sum, k) => sum + Number(k.total_foto || 0), 0);
  const totalHfAi = (kelasList || []).reduce((sum, k) => sum + Number(k.jml_hf || 0), 0);

  const now = new Date();
  const growthLabels = [];
  const growthToko = [];
  const growthPengguna = [];
  const growthTransaksi = [];

  for (let offset = 3; offset >= 0; offset--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
    const cutoffIso = offset === 0 ? new Date().toISOString() : nextMonthStart.toISOString();

    const label = monthStart.toLocaleDateString('id-ID', {
      month: 'short',
      year: '2-digit',
      timeZone: 'Asia/Jakarta',
    });

    growthLabels.push(label);
    growthToko.push(stores.filter((s) => !s.dibuat_pada || s.dibuat_pada <= cutoffIso).length);
    growthPengguna.push(users.filter((u) => !u.dibuat_pada || u.dibuat_pada <= cutoffIso).length);
    growthTransaksi.push(txs.filter((t) => !t.tgl_transaksi || t.tgl_transaksi <= cutoffIso).length);
  }

  const recentToko = stores.slice(0, 6).map((t) => {
    const storeUsers = users.filter((u) => u.toko_id === t.id);
    const storeTxs = txs.filter((tx) => tx.toko_id === t.id);
    return {
      ...t,
      jml_pengguna: storeUsers.length,
      jml_transaksi: storeTxs.length,
      total_gmv: storeTxs.reduce((s, x) => s + Number(x.total || 0), 0),
    };
  });

  return {
    tenant: { total_toko: totalToko, toko_aktif: tokoAktif, toko_nonaktif: totalToko - tokoAktif },
    pengguna: { total: totalPengguna, owner: totalOwner, kasir: totalKasir },
    transaksi: { total_transaksi: totalTransaksi, total_gmv: totalGmv },
    produk_master: {
      total: masters.length,
      merek_unik: new Set(masters.map((m) => m.merek).filter(Boolean)).size,
    },
    ai: {
      model_aktif: activeModel?.versi || null,
      arsitektur: activeModel?.arsitektur || activeModel?.nama_model || null,
      akurasi_top1: activeModel?.akurasi_top1 ?? null,
      latensi_ms: activeModel?.latensi_ms ?? null,
      total_kelas: (kelasList || []).length,
      total_sampel: totalFotoAi,
      tersinkron_hf: totalHfAi,
    },
    pertumbuhan: { labels: growthLabels, toko: growthToko, pengguna: growthPengguna, transaksi: growthTransaksi },
    kesehatan_layanan: {
      backend: true,
      database: true,
      storage: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
      model_aktif: Boolean(activeModel),
      huggingface: Boolean(config.huggingFace.token),
    },
    toko_terbaru: recentToko,
  };
}

/**
 * Daftar Seluruh Toko Tenant di Platform (Diperkaya dengan Metrik Pengguna, Produk, & Transaksi)
 */
export async function listTokoPlatform({ search, status, limit = 50, page = 1 }) {
  const cleanPage = Math.max(1, Number(page) || 1);
  const cleanLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const from = (cleanPage - 1) * cleanLimit;
  const to = from + cleanLimit - 1;

  let query = supabaseAdmin.from('toko').select('*', { count: 'exact' });
  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(
      `nama.ilike.%${cleanSearch}%,kode.ilike.%${cleanSearch}%,pemilik.ilike.%${cleanSearch}%,kota.ilike.%${cleanSearch}%`
    );
  }
  if (status) {
    query = query.eq('status', status);
  }

  const { data: stores, count, error } = await query.order('dibuat_pada', { ascending: false }).range(from, to);
  if (error) throw error;

  const storeIds = (stores || []).map((s) => s.id);
  let users = [];
  let products = [];
  let txs = [];
  let aiLogs = [];

  if (storeIds.length > 0) {
    [users, products, txs, aiLogs] = await Promise.all([
      fetchAllRows(() => supabaseAdmin.from('pengguna').select('id, toko_id, email, peran').in('toko_id', storeIds).order('id')),
      fetchAllRows(() => supabaseAdmin.from('produk').select('id, toko_id').in('toko_id', storeIds).order('id')),
      fetchAllRows(() =>
        supabaseAdmin.from('transaksi').select('id, toko_id, total').in('toko_id', storeIds).eq('status', 'selesai').order('id')
      ),
      fetchAllRows(() =>
        supabaseAdmin.from('ai_log_inferensi').select('id, toko_id, diterima_kasir, butuh_koreksi').in('toko_id', storeIds).order('id')
      ),
    ]);
  }

  const items = (stores || []).map((store) => {
    const sUsers = users.filter((u) => u.toko_id === store.id);
    const ownerUser = sUsers.find((u) => u.peran === 'owner');
    const sProds = products.filter((p) => p.toko_id === store.id);
    const sTxs = txs.filter((t) => t.toko_id === store.id);
    const sAi = aiLogs.filter((a) => a.toko_id === store.id);
    const aiAccepted = sAi.filter((a) => a.diterima_kasir && !a.butuh_koreksi).length;

    return {
      ...store,
      email_owner: ownerUser?.email || '-',
      jml_pengguna: sUsers.length,
      jml_produk: sProds.length,
      jml_transaksi: sTxs.length,
      total_gmv: sTxs.reduce((sum, tx) => sum + Number(tx.total || 0), 0),
      jml_scan_ai: sAi.length,
      akurasi_ai: sAi.length > 0 ? Number(((aiAccepted / sAi.length) * 100).toFixed(1)) : null,
    };
  });

  const total = count || 0;
  return {
    items,
    pagination: { total, page: cleanPage, limit: cleanLimit, total_pages: Math.max(1, Math.ceil(total / cleanLimit)) },
  };
}

/**
 * Detail Satu Toko Tenant Beserta Daftar Pengguna & Statistiknya
 */
export async function getDetailTokoPlatform(tokoId) {
  let query = supabaseAdmin.from('toko').select('*');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokoId)) {
    query = query.eq('id', tokoId);
  } else {
    query = query.eq('kode', tokoId);
  }

  const { data: toko, error } = await query.maybeSingle();
  if (error) throw error;
  if (!toko) throw new NotFound('Toko tidak ditemukan');

  const [{ data: pengguna }, { count: jmlProduk }, allCompletedTxs, { data: txs }, { data: shifts }] =
    await Promise.all([
      supabaseAdmin
        .from('pengguna')
        .select('id, nama_lengkap, email, telepon, peran, aktif, login_terakhir, dibuat_pada')
        .eq('toko_id', toko.id)
        .order('peran', { ascending: false }),
      supabaseAdmin.from('produk').select('id', { count: 'exact', head: true }).eq('toko_id', toko.id),
      fetchAllRows(() =>
        supabaseAdmin.from('transaksi').select('id, total').eq('toko_id', toko.id).eq('status', 'selesai').order('id')
      ),
      supabaseAdmin
        .from('transaksi')
        .select('id, no_transaksi, total, metode_bayar, status, tgl_transaksi')
        .eq('toko_id', toko.id)
        .order('tgl_transaksi', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('shift_kasir')
        .select('id, nomor_shift, status, buka_pada, tutup_pada, kas_awal, kas_sistem, kas_fisik, selisih, total_transaksi, total_tunai, total_qris')
        .eq('toko_id', toko.id)
        .order('buka_pada', { ascending: false })
        .limit(10),
    ]);

  const totalGmv = allCompletedTxs.reduce((sum, t) => sum + Number(t.total || 0), 0);

  return {
    toko,
    pengguna: pengguna || [],
    statistik: {
      jml_pengguna: (pengguna || []).length,
      jml_produk: jmlProduk || 0,
      jml_transaksi: allCompletedTxs.length,
      total_gmv: totalGmv,
    },
    transaksi_terbaru: (txs || []).map((t) => ({ ...t, nomor_faktur: t.no_transaksi, dibuat_pada: t.tgl_transaksi })),
    shift_terbaru: (shifts || []).map((s) => ({
      ...s,
      modal_awal: Number(s.kas_awal ?? 0),
      kas_aktual: s.kas_fisik != null ? Number(s.kas_fisik) : null,
      kas_sistem: s.kas_sistem != null ? Number(s.kas_sistem) : null,
      selisih_kas: s.selisih != null ? Number(s.selisih) : null,
      waktu_buka: s.buka_pada,
      waktu_tutup: s.tutup_pada,
      total_penjualan_tunai: s.total_tunai,
      total_penjualan_non_tunai: s.total_qris,
      status: s.status === 'buka' ? 'terbuka' : 'tertutup',
    })),
  };
}
