import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';

function formatPemasokRow(row) {
  if (!row) return null;
  return {
    ...row,
    kontak_person: row.kontak_person || row.kontak || null,
  };
}

/**
 * Daftar Pemasok / Supplier Toko
 */
export async function listPemasok(tokoId, { search, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('pemasok')
    .select('*', { count: 'exact' })
    .eq('toko_id', tokoId);

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(`nama.ilike.%${cleanSearch}%,kontak.ilike.%${cleanSearch}%,telepon.ilike.%${cleanSearch}%`);
  }

  const { data, count, error } = await query
    .order('nama', { ascending: true })
    .range(from, to);

  if (error) {
    throw error;
  }

  return {
    items: (data || []).map(formatPemasokRow),
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Tambah Pemasok Baru
 */
export async function createPemasok(tokoId, payload) {
  const nama = payload.nama;
  const kontakVal = payload.kontak_person || payload.kontak || null;
  const telepon = payload.telepon || null;
  const alamat = payload.alamat || null;

  if (!nama || !nama.trim()) {
    throw new BadRequest('Nama pemasok wajib diisi');
  }

  const { data, error } = await supabaseAdmin
    .from('pemasok')
    .insert({
      toko_id: tokoId,
      nama: nama.trim(),
      kontak: kontakVal ? kontakVal.trim() : null,
      telepon: telepon ? telepon.trim() : null,
      alamat: alamat ? alamat.trim() : null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return formatPemasokRow(data);
}

/**
 * Perbarui Data Pemasok
 */
export async function updatePemasok(tokoId, id, payload) {
  const { data: exist } = await supabaseAdmin
    .from('pemasok')
    .select('id')
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (!exist) {
    throw new NotFound('Data pemasok tidak ditemukan');
  }

  const updateFields = {};
  if (payload.nama !== undefined) updateFields.nama = payload.nama.trim();
  const kontakVal = payload.kontak_person !== undefined ? payload.kontak_person : payload.kontak;
  if (kontakVal !== undefined) updateFields.kontak = kontakVal ? kontakVal.trim() : null;
  if (payload.telepon !== undefined) updateFields.telepon = payload.telepon ? payload.telepon.trim() : null;
  if (payload.alamat !== undefined) updateFields.alamat = payload.alamat ? payload.alamat.trim() : null;

  const { data, error } = await supabaseAdmin
    .from('pemasok')
    .update(updateFields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return formatPemasokRow(data);
}

/**
 * Hapus Pemasok
 */
export async function deletePemasok(tokoId, id) {
  const { data: exist } = await supabaseAdmin
    .from('pemasok')
    .select('id, nama')
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (!exist) {
    throw new NotFound('Data pemasok tidak ditemukan');
  }

  // Cek relasi ke kulakan
  const { count } = await supabaseAdmin
    .from('kulakan')
    .select('id', { count: 'exact', head: true })
    .eq('pemasok_id', id);

  if (count && count > 0) {
    throw new BadRequest(`Pemasok '${exist.nama}' tidak dapat dihapus karena memiliki riwayat faktur belanja kulakan`);
  }

  const { error } = await supabaseAdmin
    .from('pemasok')
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }

  return { id, message: 'Pemasok berhasil dihapus' };
}

