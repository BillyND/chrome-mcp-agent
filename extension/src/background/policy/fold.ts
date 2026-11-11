// Text normalisation for keyword matching: lowercase, no diacritics ("Thanh toán" -> "thanh toan",
// "Đặt hàng" -> "dat hang"), single spaces. Lets one ASCII pattern cover English and Vietnamese.

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
