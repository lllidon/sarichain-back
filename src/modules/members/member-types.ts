export enum MemberGroup {
  Users = 'users',
  Customers = 'customers',
  Producers = 'producers',
  Services = 'service-providers',
}

export const memberTypes = {
  [MemberGroup.Users]: ['sales', 'finance', 'management', 'commerce', 'operations', 'other'],
  [MemberGroup.Customers]: ['consumer', 'retailer', 'wholesaler', 'other'],
  [MemberGroup.Producers]: ['orchard', 'farm', 'dairy', 'greenhouse', 'other'],
  [MemberGroup.Services]: ['driver', 'warehouse', 'harvest', 'labor', 'supervisor', 'quality', 'other'],
} as const;

export const reviewStates = ['pending', 'approved', 'rejected'] as const;
export const reviewTargets = ['sellerReview', 'driverReview', 'specialistReview'] as const;
export type ReviewTarget = typeof reviewTargets[number];
export const vehicleTypes = ['motorcycle', 'car', 'pickup', 'van', 'truckette', 'truck'] as const;
export const needsSpecialistReview = (services: string[] = []) => services.some(type => type === 'supervisor' || type === 'quality');
