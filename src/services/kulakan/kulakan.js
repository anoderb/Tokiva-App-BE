import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';
import { parseReturMutasiRow } from './kulakan-retur.js';

export { bayarUtangKulakan } from './kulakan-bayar.js';
export { createKulakan } from './kulakan-create.js';
export { listReturKulakan, returKulakan } from './kulakan-retur.js';

/**
 * Daftar Riwayat Belanja Kulakan Toko
 */
export async function listKulakan(tokoId, { pemasok_id, status, search, limit = 15, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('kulakan')
    .select(
      `
      *,
      pemasok:pemasok_id(id, nama, kontak, telepon)
    `,
      { count: 'exact' }
    )
    .eq('toko_id', tokoId);

  if (pemasok_id) {
    query = query.eq('pemasok_id', pemasok_id);
  }

  if (status) {
    if (status === 'lunas') {
      query = query.eq('lunas', true);
    } else if (status === 'belum_lunas') {
      query = query.eq('lunas', false);
    } else {
      query = query.eq('status', status);
    }
  }

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(`no_faktur.ilike.%${cleanSearch}%`);
  }

  const { data, count, error } = await query
    .order('tgl_beli', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }

  return {
    items: data || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Detail Faktur Belanja Kulakan Beserta Rincian Barang
 */
export async function getDetailKulakan(tokoId, id) {
  const { data: header, error: headErr } = await supabaseAdmin
    .from('kulakan')
    .select(
      `
      *,
      pemasok:pemasok_id(*)
    `
    )
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (headErr) throw headErr;
  if (!header) throw new NotFound('Faktur kulakan tidak ditemukan');

  const { data: details, error: detErr } = await supabaseAdmin
    .from('kulakan_detail')
    .select(
      `
      *,
      produk:produk_id(id, nama, barcode, satuan_dasar, harga_jual)
    `
    )
    .eq('kulakan_id', id);

  if (detErr) throw detErr;

  const { data: riwayatBayar } = await supabaseAdmin
    .from('arus_kas')
    .select('*')
    .eq('toko_id', tokoId)
    .eq('ref_id', id)
    .eq('kategori', 'kulakan')
    .eq('tipe', 'keluar')
    .order('tgl_kas', { ascending: false });

  const { data: riwayatReturRaw } = await supabaseAdmin
    .from('mutasi_stok')
    .select(
      `
      *,
      produk:produk_id(id, nama, barcode, satuan_dasar)
    `
    )
    .eq('toko_id', tokoId)
    .eq('ref_id', id)
    .eq('jenis', 'retur')
    .order('waktu', { ascending: false });

  const totalDibayar = (riwayatBayar || []).reduce((sum, r) => sum + Number(r.nominal || 0), 0);
  const sisaUtang = header.lunas ? 0 : Math.max(0, Number(header.total_beli || 0) - totalDibayar);

  return {
    ...header,
    items: details || [],
    riwayat_pembayaran: riwayatBayar || [],
    riwayat_retur: (riwayatReturRaw || []).map(parseReturMutasiRow),
    total_dibayar: totalDibayar,
    sisa_utang: sisaUtang,
  };
}
