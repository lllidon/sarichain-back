export const mobileNumberPattern = /^\+989[0-9]{9}$/;

export function normalizePhone(value: string): string {
  const phone = value.trim()
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

  return /^09[0-9]{9}$/.test(phone) ? `+98${phone.slice(1)}` : phone;
}
