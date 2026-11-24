/**
 * Engine low-level EMVCo TLV & CRC16-CCITT untuk QRIS MPM Indonesia.
 */

export function calculateCRC16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

const TAG_NAMES = {
  '00': 'Payload Format Indicator',
  '01': 'Point of Initiation Method',
  '02': 'Visa',
  '03': 'Mastercard',
  '04': 'Mastercard',
  '15': 'Visa',
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String(i + 26).padStart(2, '0'), 'Merchant Account Information'])),
  '52': 'Merchant Category Code',
  '53': 'Transaction Currency',
  '54': 'Transaction Amount',
  '55': 'Tip or Convenience Indicator',
  '56': 'Value of Convenience Fee (Fixed)',
  '57': 'Value of Convenience Fee (%)',
  '58': 'Country Code',
  '59': 'Merchant Name',
  '60': 'Merchant City',
  '61': 'Postal Code',
  '62': 'Additional Data Field',
  '63': 'CRC',
};

const NESTED_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(i + 26).padStart(2, '0')),
  '62',
]);

/** Mengurai string EMVCo TLV menjadi array objek tag-length-value (termasuk sub-tag bertingkat). */
export function parseTLV(data, { strict = false } = {}) {
  if (typeof data !== 'string') throw new Error('QRIS harus berupa string teks');

  const elements = [];
  let pos = 0;
  while (pos < data.length) {
    if (pos + 4 > data.length) {
      if (strict) throw new Error('Struktur QRIS tidak lengkap');
      break;
    }

    const tag = data.substring(pos, pos + 2);
    const lengthText = data.substring(pos + 2, pos + 4);
    const length = Number.parseInt(lengthText, 10);
    if (!/^\d{2}$/.test(lengthText) || Number.isNaN(length)) {
      if (strict) throw new Error('Format panjang data QRIS tidak valid');
      break;
    }
    if (pos + 4 + length > data.length) {
      if (strict) throw new Error('Data QRIS terpotong atau tidak lengkap');
      break;
    }

    const value = data.substring(pos + 4, pos + 4 + length);
    const element = { tag, name: TAG_NAMES[tag] ?? `Unknown (${tag})`, length, value };
    if (NESTED_TAGS.has(tag)) element.children = parseTLV(value, { strict });
    elements.push(element);
    pos += 4 + length;
  }

  if (strict && pos !== data.length) throw new Error('Masih ada data QRIS yang tidak terbaca');
  return elements;
}

export function buildTLVString(elements) {
  return elements
    .map((element) => {
      const value = element.children ? buildTLVString(element.children) : element.value;
      return `${element.tag}${value.length.toString().padStart(2, '0')}${value}`;
    })
    .join('');
}

export function makeTLV(tag, value, name = '') {
  return { tag, name, length: value.length, value };
}
