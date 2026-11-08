import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'gateway:is-public';
export const Public = () => SetMetadata(IS_PUBLIC, true);
