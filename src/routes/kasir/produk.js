import { listProdukKasir, getDetailProduk } from '../../services/produk/katalog.js';
import { scanBarcode } from '../../services/produk/scan.js';
import { produkSchema } from '../../schemas/produk.js';
import { ok } from '../../utils/response.js';

export default async function kasirProdukRoutes(app) {
  // 1. Scan Barcode Kasir POS (< 30ms)
  app.get('/produk/scan/:barcode', { schema: produkSchema.scan }, async (req, reply) => {
    const data = await scanBarcode(req.toko_id, req.params.barcode);
    return ok(reply, data, 'Produk ditemukan');
  });

  // 2. List Produk Grid Kasir
  app.get('/produk', { schema: produkSchema.listKasir }, async (req, reply) => {
    const data = await listProdukKasir(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 3. Detail Produk
  app.get('/produk/:id', { schema: produkSchema.detail }, async (req, reply) => {
    const data = await getDetailProduk(req.toko_id, req.params.id);
    return ok(reply, data);
  });
}

