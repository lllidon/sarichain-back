import { BadRequestException } from '@nestjs/common';

export const deliveryMethods = ['express', 'standard', 'economy'] as const;
export const deliverySlots = [
  { id: 'morning', label: '۹ تا ۱۲' },
  { id: 'afternoon', label: '۱۲ تا ۱۵' },
  { id: 'evening', label: '۱۵ تا ۱۸' },
] as const;

const policies = [
  { id: 'express', label: 'ارسال سریع', lead: 1, fee: 0.45, env: 'WEB_DELIVERY_EXPRESS_FEE' },
  { id: 'standard', label: 'ارسال عادی', lead: 2, fee: 0.3, env: 'WEB_DELIVERY_STANDARD_FEE' },
  { id: 'economy', label: 'ارسال اقتصادی', lead: 4, fee: 0.15, env: 'WEB_DELIVERY_ECONOMY_FEE' },
] as const;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function deliveryOptions(now = new Date()) {
  const today = dateFormatter.format(now);
  const start = new Date(today + 'T12:00:00Z');
  return policies.map(policy => {
    const raw = process.env[policy.env]?.trim();
    const configured = raw ? Number(raw) : NaN;
    const fee = Number.isFinite(configured) && configured >= 0 && configured <= 1_000_000
      ? Math.round(configured * 1e6) / 1e6 : policy.fee;
    const dayAt = (offset: number) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const windows = Array.from({ length: 7 }, (_, index) => ({
      dispatchDate: dayAt(index + 1), deliveryDate: dayAt(index + 1 + policy.lead),
    }));
    return { id: policy.id, label: policy.label, windows, slots: deliverySlots, fee };
  });
}

export function resolveDelivery(input: { method: string; dispatchDate: string; slot: string }, options = deliveryOptions()) {
  const method = options.find(option => option.id === input.method);
  const slot = deliverySlots.find(option => option.id === input.slot);
  const window = method?.windows.find(option => option.dispatchDate === input.dispatchDate);
  if (!method || !slot || !window) {
    throw new BadRequestException('روش یا زمان ارسال معتبر نیست. گزینه‌های ارسال را دوباره بررسی کنید.');
  }
  return { ...input, date: window.deliveryDate, label: method.label, slotLabel: slot.label, fee: method.fee };
}
