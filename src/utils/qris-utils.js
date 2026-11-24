/**
 * QRIS Utilities — EMVCo MPM Engine untuk Tokiva POS
 * Menangani parsing, validasi, dan konversi QRIS statis toko menjadi QRIS dinamis ber-nominal.
 */
import { buildTLVString, calculateCRC16, makeTLV, parseTLV } from './qris-tlv.js';

export { calculateCRC16, parseTLV };

export function parseQRIS(qrisString) {
  const raw = parseTLV(String(qrisString || '').trim(), { strict: true });
  const findTag = (tag) => raw.find((t) => t.tag === tag);
  const method = findTag('01')?.value === '12' ? 'dynamic' : 'static';
  const tipIndicatorValue = findTag('55')?.value;
  let tipIndicator;
  if (tipIndicatorValue === '01') tipIndicator = 'prompt';
  else if (tipIndicatorValue === '02') tipIndicator = 'fixed';
  else if (tipIndicatorValue === '03') tipIndicator = 'percentage';

  const merchantAccountInfo = raw
    .filter((t) => {
      const tagNum = Number.parseInt(t.tag, 10);
      return tagNum >= 26 && tagNum <= 51 && t.children;
    })
    .map((t) => {
      const children = t.children || [];
      const findChild = (tag) => children.find((child) => child.tag === tag);
      return {
        tag: t.tag,
        globallyUniqueId: findChild('00')?.value || '',
        merchantId: findChild('01')?.value || findChild('02')?.value || '',
        merchantCriteria: findChild('03')?.value || '',
        fields: children,
      };
    });

  return {
    version: findTag('00')?.value || '01',
    method,
    merchantAccountInfo,
    merchantCategoryCode: findTag('52')?.value || '',
    currency: findTag('53')?.value || '360',
    amount: findTag('54')?.value,
    tipIndicator,
    tipFixed: findTag('56')?.value,
    tipPercentage: findTag('57')?.value,
    countryCode: findTag('58')?.value || 'ID',
    merchantName: findTag('59')?.value || '',
    merchantCity: findTag('60')?.value || '',
    postalCode: findTag('61')?.value || '',
    additionalData: findTag('62')?.children,
    crc: findTag('63')?.value || '',
    raw,
  };
}

/**
 * Validasi ketat format QRIS asli Indonesia
 */
export function validateQRIS(
  qrisString,
  { requireStatic = false, requireIdr = false, requireMerchantDetails = false } = {}
) {
  const errors = [];
  if (typeof qrisString !== 'string' || qrisString.trim().length === 0) {
    return { valid: false, errors: ['QRIS kosong'] };
  }

  const str = qrisString.trim();
  if (!str.startsWith('000201')) errors.push('Format QRIS tidak dikenali (harus diawali 000201)');
  if (str.length < 20) {
    errors.push('Data QRIS terlalu pendek');
    return { valid: false, errors };
  }
  if (!/^[\x20-\x7E]+$/.test(str)) errors.push('Data QRIS mengandung karakter yang tidak valid');

  const crcHeader = str.substring(str.length - 8, str.length - 4);
  const declaredCRC = str.substring(str.length - 4);
  if (crcHeader !== '6304' || !/^[0-9A-Fa-f]{4}$/.test(declaredCRC)) {
    errors.push('Kode keamanan QRIS (CRC16) tidak lengkap');
  } else if (declaredCRC.toUpperCase() !== calculateCRC16(str.substring(0, str.length - 4))) {
    errors.push('Kode keamanan QRIS tidak cocok (CRC mismatch)');
  }

  let elements = [];
  try {
    elements = parseTLV(str, { strict: true });
  } catch (error) {
    errors.push(error.message || 'Struktur QRIS tidak valid');
  }

  const tags = new Set(elements.map((element) => element.tag));
  for (const [tag, label] of [
    ['00', 'format QRIS'],
    ['01', 'jenis QRIS'],
    ['52', 'kategori merchant'],
    ['53', 'mata uang'],
    ['58', 'negara'],
    ['59', 'nama merchant'],
    ['60', 'kota merchant'],
    ['63', 'kode keamanan'],
  ]) {
    if (!tags.has(tag)) errors.push(`Informasi ${label} belum lengkap`);
  }

  const method = elements.find((element) => element.tag === '01')?.value;
  if (method && method !== '11' && method !== '12') errors.push('Jenis QRIS tidak dikenali');
  if (requireStatic && method && method !== '11') errors.push('Gunakan QRIS statis milik toko, bukan QRIS dinamis');

  const hasMerchant = elements.some((element) => {
    const number = Number.parseInt(element.tag, 10);
    return number >= 26 && number <= 51 && element.children?.length;
  });
  if (!hasMerchant) errors.push('Informasi akun merchant QRIS belum lengkap');

  const parsedCurrency = elements.find((element) => element.tag === '53')?.value;
  if (requireIdr && parsedCurrency && parsedCurrency !== '360') errors.push('QRIS harus menggunakan mata uang Rupiah (IDR 360)');

  const merchantName = elements.find((element) => element.tag === '59')?.value?.trim();
  const merchantCity = elements.find((element) => element.tag === '60')?.value?.trim();
  if (requireMerchantDetails && !merchantName) errors.push('Nama merchant QRIS belum tersedia');
  if (requireMerchantDetails && !merchantCity) errors.push('Kota merchant QRIS belum tersedia');

  return { valid: errors.length === 0, errors };
}

/**
 * Konversi QRIS Statis menjadi QRIS Dinamis ber-nominal
 */
export function convertQRIS(qrisString, options = {}) {
  const validation = validateQRIS(qrisString, { requireStatic: true, requireIdr: true, requireMerchantDetails: true });
  if (!validation.valid) throw new Error('QRIS sumber tidak valid: ' + validation.errors.join(', '));

  const amount = Math.round(Number(options.amount));
  if (!Number.isSafeInteger(amount) || amount <= 0 || String(amount).length > 13) {
    throw new Error('Nominal transaksi QRIS tidak valid');
  }

  const elements = parseTLV(qrisString.trim(), { strict: true });
  const result = [];
  let amountInserted = false;
  const managedTags = new Set(['54', '55', '56', '57', '63']);

  for (const element of elements) {
    if (managedTags.has(element.tag)) continue;
    if (element.tag === '01') {
      result.push(makeTLV('01', '12', 'Point of Initiation Method'));
      continue;
    }

    if (element.tag === '58' && !amountInserted) {
      result.push(makeTLV('54', String(amount), 'Transaction Amount'));
      if (options.fee) {
        const feeValue = Number(options.fee.value);
        if (!Number.isFinite(feeValue) || feeValue < 0) throw new Error('Biaya QRIS tidak valid');
        if (options.fee.type === 'fixed') {
          result.push(makeTLV('55', '02', 'Tip or Convenience Indicator'));
          result.push(makeTLV('56', String(options.fee.value), 'Value of Convenience Fee (Fixed)'));
        } else if (options.fee.type === 'percentage') {
          result.push(makeTLV('55', '03', 'Tip or Convenience Indicator'));
          result.push(makeTLV('57', String(options.fee.value), 'Value of Convenience Fee (%)'));
        }
      }
      amountInserted = true;
    }
    result.push(element);
  }

  if (!amountInserted) throw new Error('Struktur QRIS tidak memiliki lokasi nominal yang valid');

  const crcInput = `${buildTLVString(result)}6304`;
  const converted = crcInput + calculateCRC16(crcInput);
  const convertedValidation = validateQRIS(converted, { requireIdr: true, requireMerchantDetails: true });
  if (!convertedValidation.valid) throw new Error('QRIS dinamis gagal diverifikasi: ' + convertedValidation.errors.join(', '));

  const parsed = parseQRIS(converted);
  if (parsed.method !== 'dynamic' || parsed.amount !== String(amount)) throw new Error('Nominal QRIS dinamis tidak sesuai transaksi');
  return converted;
}
