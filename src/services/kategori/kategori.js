import { supabaseAdmin } from '../../lib/supabase.js';
import { slugify } from '../../utils/format.js';
import { BadRequest, NotFound } from '../../utils/errors.js';

/**
 * Mengambil daftar kategori: kategori master global (toko_id NULL) + kategori spesifik toko
 */
export async function listKategori(tokoId) {
  const { data, error } = await supabaseAdmin
    .from('kategori')
    .select('*')
    .or(`toko_id.is.null,toko_id.eq.${tokoId}`)
    .order('urutan', { ascending: true })
    .order('nama', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Menambahkan kategori baru untuk toko
 */
export async function createKategori(tokoId, { nama, slug, urutan = 0 }) {
  if (!nama) {
    throw new BadRequest('Nama kategori wajib diisi');
  }

  const cleanSlug = slug ? slugify(slug) : slugify(nama);

  const { data, error } = await supabaseAdmin
    .from('kategori')
    .insert({
      toko_id: tokoId,
      nama: nama.trim(),
      slug: cleanSlug,
      urutan: Number(urutan) || 0,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Memperbarui data kategori milik toko
 */
export async function updateKategori(tokoId, kategoriId, { nama, slug, urutan }) {
  const updateData = {};
  if (nama) {
    updateData.nama = nama.trim();
    if (!slug) updateData.slug = slugify(nama);
  }
  if (slug) updateData.slug = slugify(slug);
  if (urutan !== undefined) updateData.urutan = Number(urutan);

  const { data, error } = await supabaseAdmin
    .from('kategori')
    .update(updateData)
    .eq('id', kategoriId)
    .eq('toko_id', tokoId) // Hanya boleh edit kategori milik toko sendiri, bukan master global
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new NotFound('Kategori tidak ditemukan atau kategori master platform tidak dapat diubah');
  }

  return data;
}

/**
 * Menghapus kategori milik toko (jika tidak ada produk aktif di dalamnya)
 */
export async function deleteKategori(tokoId, kategoriId) {
  // Cek apakah ada produk toko yang menggunakan kategori ini
  const { count, error: countErr } = await supabaseAdmin
    .from('produk')
    .select('id', { count: 'exact', head: true })
    .eq('kategori_id', kategoriId)
    .eq('toko_id', tokoId)
    .eq('aktif', true);

  if (countErr) {
    throw countErr;
  }

  if (count > 0) {
    throw new BadRequest(`Kategori tidak dapat dihapus karena masih digunakan oleh ${count} produk aktif`);
  }

  const { error } = await supabaseAdmin
    .from('kategori')
    .delete()
    .eq('id', kategoriId)
    .eq('toko_id', tokoId);

  if (error) {
    throw error;
  }

  return { id: kategoriId, deleted: true };
}

