import { SetMetadata } from '@nestjs/common';

export type AccessRole = 'management' | 'admin' | 'client';
export type AccessContext = { id: string; role: AccessRole; branchId?: string; profileId?: string; name?: string };
export type AccessRequest = { userId: string; access: AccessContext };
export const clientAccessKey = 'allowClient';
export const AllowClient = () => SetMetadata(clientAccessKey, true);
