import {
  listProdukOwner,
  getDetailProduk,
  createProduk,
  updateProduk,
  deleteProduk,
} from '../../services/produk/katalog.js';
import { addSatuanGrosir, removeSatuanGrosir } from '../../services/produk/satuan.js';
import { getProdukMasterByBarcode } from '../../services/produk/master.js';
import { listProdukMaster } from '../../services/admin/produk-master.js';
import { produkSchema } from '../../schemas/produk.js';
import { adminSchema } from '../../schemas/admin.js';
import { ok } from '../../utils/response.js';

export default async function ownerProdukRoutes(app) {
  // 1. List Produk Lengkap Owner (dengan margin keuntungan)
  app.get('/produk', { schema: produkSchema.listOwner }, async (req, reply) => {
    const data = await listProdukOwner(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Detail Produk
  app.get('/produk/:id', { schema: produkSchema.detail }, async (req, reply) => {
    const data = await getDetailProduk(req.toko_id, req.params.id);
    return ok(reply, data);
  });

  // 3. Tambah Produk Baru
  app.post('/produk', { schema: produkSchema.create }, async (req, reply) => {
    const data = await createProduk(req.toko_id, req.body);
    return ok(reply, data, 'Produk berhasil ditambahkan ke toko', 201);
  });

  // 4. Update Produk
  app.put('/produk/:id', { schema: produkSchema.update }, async (req, reply) => {
    const data = await updateProduk(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Data produk berhasil diperbarui');
  });

  // 5. Hapus Produk (Soft Delete)
  app.delete('/produk/:id', { schema: produkSchema.delete }, async (req, reply) => {
    const data = await deleteProduk(req.toko_id, req.params.id);
    return ok(reply, data, 'Produk berhasil dinonaktifkan');
  });

  // 6. Tambah Multi-Satuan Grosir (Dus/Karton/Renceng)
  app.post('/produk/:id/satuan', { schema: produkSchema.addSatuan }, async (req, reply) => {
    const data = await addSatuanGrosir(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Satuan grosir berhasil ditambahkan', 201);
  });

  // 7. Hapus Multi-Satuan Grosir
  app.delete('/produk/:id/satuan/:satuanId', { schema: produkSchema.removeSatuan }, async (req, reply) => {
    const data = await removeSatuanGrosir(req.toko_id, req.params.id, req.params.satuanId);
    return ok(reply, data, 'Satuan grosir berhasil dihapus');
  });

  // 8. Daftar Katalog Master Global EAN-13 (untuk Adopsi Produk)
  app.get('/produk-master', { schema: adminSchema.listProdukMaster }, async (req, reply) => {
    const data = await listProdukMaster(req.query);
    return ok(reply, data);
  });

  // 9. Auto-fill dari Katalog Master Global EAN-13 berdasarkan Barcode
  app.get('/produk-master/:barcode', { schema: produkSchema.master }, async (req, reply) => {
    const data = await getProdukMasterByBarcode(req.params.barcode);
    return ok(reply, data, 'Data master produk ditemukan');
  });
}

