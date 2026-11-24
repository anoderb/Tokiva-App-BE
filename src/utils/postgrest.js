/**
 * Sanitasi istilah pencarian sebelum disisipkan ke filter PostgREST `.or()` / `.ilike()`.
 * Menghapus operator & tanda baca sintaks PostgREST seperti `,`, `(`, `)`, `*`, `%`, `\`.
 */
export function sanitizeSearchTerm(value) {
  return String(value ?? '')
    .trim()
    .replace(/[%*,()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
