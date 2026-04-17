import type { Request } from 'express';

export interface VersionedRequest extends Request {
    apiVersion?: string;
}

export interface UnsupportedVersionResponse {
    error: string;
    supportedVersions: string[];
}
