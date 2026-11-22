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
