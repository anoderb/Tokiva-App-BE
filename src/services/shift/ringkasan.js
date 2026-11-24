import { supabaseAdmin } from '../../lib/supabase.js';
import { Forbidden, NotFound } from '../../utils/errors.js';
import { computeShiftPettyCash, formatShiftRow } from './buka-tutup.js';

/**
 * Ringkasan Detail 1 Sesi Shift
 */
export async function getRingkasanShift(tokoId, shiftId, kasirIdGuard = null) {
  let query = supabaseAdmin
    .from('shift_kasir')
    .select('*, kasir:kasir_id(id, nama_lengkap, email)')
    .eq('id', shiftId);

  if (tokoId) {
    query = query.eq('toko_id', tokoId);
  }

  const { data: shift, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (!shift) {
    throw new NotFound('Shift tidak ditemukan');
  }

  if (kasirIdGuard && shift.kasir_id !== kasirIdGuard) {
    throw new Forbidden('Kasir hanya dapat melihat detail shift miliknya sendiri');
  }

  const pettyCash = await computeShiftPettyCash(shift);
  return formatShiftRow(shift, pettyCash);
}

/**
 * Rekap Riwayat Seluruh Shift Toko (Owner Audit)
 */
export async function getRiwayatShift(tokoId, { kasir_id, limit = 20, page = 1 } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('shift_kasir')
    .select('*, kasir:kasir_id(id, nama_lengkap, email)', { count: 'exact' });

  if (tokoId) {
    query = query.eq('toko_id', tokoId);
  }

  if (kasir_id) {
    query = query.eq('kasir_id', kasir_id);
  }

  const { data, count, error } = await query
    .order('buka_pada', { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }

  const formattedItems = (data || []).map(formatShiftRow);

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
