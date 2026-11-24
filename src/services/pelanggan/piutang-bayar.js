import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, Conflict, NotFound } from '../../utils/errors.js';
import {
  adjustPelangganPiutangAtomic,
  adjustShiftCountersAtomic,
} from '../../utils/atomic-db.js';
import { getShiftAktif } from '../shift/buka-tutup.js';

async function syncPaymentToActiveShift(tokoId, kasirId, inputShiftId, metode, nominal) {
  let activeShiftId = inputShiftId;
  if (!activeShiftId && kasirId) {
    const shift = await getShiftAktif(tokoId, kasirId);
    if (shift) activeShiftId = shift.id;
  }

  if (activeShiftId && (metode === 'tunai' || metode === 'qris')) {
    await adjustShiftCountersAtomic({
      tokoId,
      shiftId: activeShiftId,
      deltaTunai: metode === 'tunai' ? nominal : 0,
      deltaQris: metode === 'qris' ? nominal : 0,
    });
  }
}

/**
 * Pembayaran Piutang Berbasis FIFO untuk Satu Pelanggan (Melunasi bon tertua dulu)
 */
export async function bayarPiutangFifo(tokoId, kasirId, payload) {
  const {
    pelanggan_id,
    nominal_bayar,
    metode = 'tunai',
    shift_id: inputShiftId,
    no_bukti = null,
    catatan = null,
  } = payload;

  const nominal = Number(nominal_bayar);
  if (!nominal || nominal <= 0) {
    throw new BadRequest('Nominal pembayaran bon harus lebih dari 0');
  }

  const { data: pelanggan, error: pelErr } = await supabaseAdmin
    .from('pelanggan')
    .select('id, nama, total_piutang')
    .eq('id', pelanggan_id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (pelErr || !pelanggan) throw new NotFound('Data pelanggan tidak ditemukan');

  const currentTotalPiutang = Number(pelanggan.total_piutang || 0);
  if (currentTotalPiutang <= 0) {
    throw new BadRequest(`Pelanggan "${pelanggan.nama}" tidak memiliki tanggungan kas bon`);
  }
  if (nominal > currentTotalPiutang) {
    throw new BadRequest(
      `Nominal pembayaran (Rp${nominal.toLocaleString('id-ID')}) melebihi total kas bon pelanggan (Rp${currentTotalPiutang.toLocaleString('id-ID')})`
    );
  }

  const { data: unpaidBons, error: bonErr } = await supabaseAdmin
    .from('piutang')
    .select('*')
    .eq('pelanggan_id', pelanggan_id)
    .eq('toko_id', tokoId)
    .neq('status', 'lunas')
    .neq('status', 'batal')
    .order('dibuat_pada', { ascending: true });
  if (bonErr) throw bonErr;

  let sisaDana = nominal;
  const settledList = [];
  const nowIso = new Date().toISOString();

  for (const bon of unpaidBons || []) {
    if (sisaDana <= 0) break;
    const sisaBon = Number(bon.sisa_bon || 0);
    if (sisaBon <= 0) continue;

    const bayarUntukBonIni = Math.min(sisaDana, sisaBon);
    const terbayarBaru = Number(bon.terbayar || 0) + bayarUntukBonIni;
    const sisaBonBaru = sisaBon - bayarUntukBonIni;
    const statusBaru = sisaBonBaru === 0 ? 'lunas' : 'belum_lunas';

    const { data: updatedBon, error: upErr } = await supabaseAdmin
      .from('piutang')
      .update({ terbayar: terbayarBaru, sisa_bon: sisaBonBaru, status: statusBaru })
      .eq('id', bon.id)
      .eq('toko_id', tokoId)
      .eq('sisa_bon', bon.sisa_bon)
      .neq('status', 'batal')
      .select('id')
      .maybeSingle();

    if (upErr) throw upErr;
    if (!updatedBon) {
      throw new Conflict('Terjadi perubahan bersamaan pada nota kas bon. Silakan coba lagi.');
    }

    const { data: bayarRecord, error: bayarErr } = await supabaseAdmin
      .from('piutang_bayar')
      .insert({
        piutang_id: bon.id,
        kasir_id: kasirId,
        nominal_bayar: bayarUntukBonIni,
        metode,
        no_bukti,
        tgl_bayar: nowIso,
      })
      .select()
      .single();
    if (bayarErr) throw bayarErr;

    settledList.push({
      piutang_id: bon.id,
      nominal_dialokasikan: bayarUntukBonIni,
      sisa_bon_sebelum: sisaBon,
      sisa_bon_sesudah: sisaBonBaru,
      status: statusBaru,
      pembayaran_id: bayarRecord?.id,
    });
    sisaDana -= bayarUntukBonIni;
  }

  const nominalTerproses = nominal - sisaDana;
  if (nominalTerproses <= 0) {
    throw new BadRequest('Tidak ada nota piutang aktif yang dapat dibayarkan');
  }

  const pelangganTotalBaru =
    (await adjustPelangganPiutangAtomic(tokoId, pelanggan_id, -nominalTerproses)) ??
    Math.max(0, currentTotalPiutang - nominalTerproses);

  await supabaseAdmin.from('arus_kas').insert({
    toko_id: tokoId,
    tipe: 'masuk',
    kategori: 'piutang',
    nominal: nominalTerproses,
    tgl_kas: nowIso.slice(0, 10),
    ref_id: settledList[0]?.pembayaran_id || null,
    kasir_id: kasirId,
    catatan: catatan || `Pelunasan Kas Bon oleh ${pelanggan.nama} (${metode})`,
  });

  await syncPaymentToActiveShift(tokoId, kasirId, inputShiftId, metode, nominalTerproses);

  return {
    pelanggan_id,
    nama_pelanggan: pelanggan.nama,
    nominal_dibayar: nominalTerproses,
    metode,
    sisa_piutang_pelanggan: pelangganTotalBaru,
    daftar_pelunasan: settledList,
  };
}

/**
 * Pembayaran Cicilan / Pelunasan Kas Bon di Meja Kasir (Single piutang_id atau FIFO)
 */
export async function bayarPiutang(tokoId, kasirId, payload) {
  if (payload.pelanggan_id && !payload.piutang_id) {
    return bayarPiutangFifo(tokoId, kasirId, payload);
  }

  const {
    piutang_id,
    nominal_bayar,
    metode = 'tunai',
    shift_id: inputShiftId,
    no_bukti = null,
    catatan = null,
  } = payload;

  const nominal = Number(nominal_bayar);
  if (!nominal || nominal <= 0) {
    throw new BadRequest('Nominal pembayaran bon harus lebih dari 0');
  }

  const { data: piutang, error: findErr } = await supabaseAdmin
    .from('piutang')
    .select('*, pelanggan:pelanggan_id(id, nama, total_piutang)')
    .eq('id', piutang_id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!piutang) throw new NotFound('Data piutang tidak ditemukan');
  if (piutang.status === 'batal') {
    throw new BadRequest('Tagihan kas bon dari transaksi yang dibatalkan tidak dapat dibayar');
  }
  if (piutang.status === 'lunas') {
    throw new BadRequest('Tagihan kas bon ini sudah lunas sebelumnya');
  }

  const sisaSaatIni = Number(piutang.sisa_bon);
  if (nominal > sisaSaatIni) {
    throw new BadRequest(`Nominal pembayaran (Rp${nominal.toLocaleString('id-ID')}) melebihi sisa utang nota (Rp${sisaSaatIni.toLocaleString('id-ID')})`);
  }

  const terbayarBaru = Number(piutang.terbayar || 0) + nominal;
  const sisaBaru = sisaSaatIni - nominal;
  const statusBaru = sisaBaru === 0 ? 'lunas' : 'belum_lunas';

  const { data: updatedPiutang, error: updateErr } = await supabaseAdmin
    .from('piutang')
    .update({ terbayar: terbayarBaru, sisa_bon: sisaBaru, status: statusBaru })
    .eq('id', piutang_id)
    .eq('toko_id', tokoId)
    .eq('sisa_bon', piutang.sisa_bon)
    .neq('status', 'batal')
    .select()
    .maybeSingle();

  if (updateErr) throw updateErr;
  if (!updatedPiutang) {
    throw new Conflict('Nota kas bon sudah berubah oleh transaksi lain. Silakan muat ulang.');
  }

  const pelangganTotal =
    (await adjustPelangganPiutangAtomic(tokoId, piutang.pelanggan_id, -nominal)) ??
    Math.max(0, Number(piutang.pelanggan?.total_piutang || 0) - nominal);

  const { data: bayarRecord, error: bayarErr } = await supabaseAdmin
    .from('piutang_bayar')
    .insert({
      piutang_id,
      kasir_id: kasirId,
      nominal_bayar: nominal,
      metode,
      no_bukti,
      tgl_bayar: new Date().toISOString(),
    })
    .select()
    .single();
  if (bayarErr) throw bayarErr;

  await supabaseAdmin.from('arus_kas').insert({
    toko_id: tokoId,
    tipe: 'masuk',
    kategori: 'piutang',
    nominal,
    tgl_kas: new Date().toISOString().slice(0, 10),
    ref_id: bayarRecord.id,
    kasir_id: kasirId,
    catatan: catatan || `Pelunasan Kas Bon oleh ${piutang.pelanggan?.nama || 'Pelanggan'} (${metode})`,
  });

  await syncPaymentToActiveShift(tokoId, kasirId, inputShiftId, metode, nominal);

  return {
    piutang: updatedPiutang,
    pembayaran: bayarRecord,
    sisa_piutang_pelanggan: pelangganTotal,
  };
}
