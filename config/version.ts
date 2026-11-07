import { version as packageVersion } from '../package.json';

export const APP_VERSION: string = process.env.VERSION?.trim() || packageVersion;
