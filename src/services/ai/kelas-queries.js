import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';
import { buildSignedHfProxyPath } from '../../routes/public/media-proxy-guard.js';

/**
 * Daftar Kelas Produk AI (Dilengkapi Thumbnail Asli dari produk_master / ai_sampel)
 */
export async function listKelasAI({ search, status, kategori, limit = 100, page = 1 } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('ai_kelas')
    .select(
      `
      *,
      master:master_id(id, nama, barcode, foto_url, merek)
    `,
      { count: 'exact' }
    );

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(`nama.ilike.%${cleanSearch}%,kode_kelas.ilike.%${cleanSearch}%,barcode.ilike.%${cleanSearch}%`);
  }
  if (status) query = query.eq('status', status);
  if (kategori) query = query.eq('kategori', kategori);

  const { data, count, error } = await query.order('nama', { ascending: true }).range(from, to);
  if (error) throw error;

  const rows = data || [];
  const missingThumbIds = rows.filter((r) => !r.master?.foto_url).map((r) => r.id);
  const sampleCoverMap = {};

  if (missingThumbIds.length > 0) {
    await Promise.all(
      missingThumbIds.map(async (kid) => {
        const { data: sRows } = await supabaseAdmin
          .from('ai_sampel')
          .select('hf_path, path_supabase, lokasi_simpan')
          .eq('kelas_id', kid)
          .limit(1);
        const s = sRows?.[0];
        if (s?.hf_path) {
          sampleCoverMap[kid] = buildSignedHfProxyPath(s.hf_path);
        }
      })
    );
  }

  const items = rows.map((row) => ({
    ...row,
    foto_url: row.master?.foto_url || sampleCoverMap[row.id] || null,
    sku: row.master?.sku || row.kode_kelas?.toUpperCase() || '-',
  }));

  return {
    items,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Detail 1 Kelas AI Beserta Sampel Foto Terkait
 */
export async function getDetailKelasAI(id) {
  let query = supabaseAdmin.from('ai_kelas').select('*, master:master_id(id, nama, barcode, foto_url, merek)');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  query = isUuid ? query.eq('id', id) : query.eq('kode_kelas', id);

  const { data: kelas, error } = await query.maybeSingle();
  if (error) throw error;
  if (!kelas) throw new NotFound('Kelas AI tidak ditemukan');

  const { data: samples } = await supabaseAdmin
    .from('ai_sampel')
    .select('*')
    .eq('kelas_id', kelas.id)
    .order('dibuat_pada', { ascending: false })
    .limit(250);

  const formattedSamples = await Promise.all(
    (samples || []).map(async (row) => {
      let fotoUrl = row.foto_url || null;
      if (!fotoUrl) {
        if (row.lokasi_simpan === 'huggingface' && row.hf_path) {
          fotoUrl = buildSignedHfProxyPath(row.hf_path);
        } else if (row.path_supabase) {
          const { data: signed } = await supabaseAdmin.storage
            .from('dataset-raw-temp')
            .createSignedUrl(row.path_supabase, 3600);
          fotoUrl = signed?.signedUrl || null;
        }
      }
      return { ...row, foto_url: fotoUrl };
    })
  );

  return {
    ...kelas,
    foto_url: kelas.master?.foto_url || formattedSamples[0]?.foto_url || null,
    samples: formattedSamples,
  };
}

/**
 * Tambah Kelas Produk AI Baru
 */
export async function createKelasAI(payload = {}, slugify = (v) => String(v || '').toLowerCase()) {
  const { nama, kode_kelas, kategori = 'Kebutuhan Harian', barcode = null, target_foto = 200, master_id = null } = payload;
  if (!nama || !String(nama).trim()) throw new BadRequest('Nama kelas produk wajib diisi');

  const cleanNama = String(nama).trim();
  const slug = kode_kelas ? slugify(kode_kelas) : slugify(cleanNama);

  const { data: existing } = await supabaseAdmin.from('ai_kelas').select('id').eq('kode_kelas', slug).maybeSingle();
  if (existing) throw new BadRequest(`Kelas dengan kode '${slug}' sudah terdaftar`);

  const { data, error } = await supabaseAdmin
    .from('ai_kelas')
    .insert({
      kode_kelas: slug,
      nama: cleanNama,
      kategori: kategori || 'Kebutuhan Harian',
      barcode: barcode ? String(barcode).trim() : null,
      master_id: master_id || null,
      target_foto: Number(target_foto) || 200,
      total_foto: 0,
      jml_supabase: 0,
      jml_hf: 0,
      status: 'Kurang Data',
      diubah_pada: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
