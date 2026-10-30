import type { UseUploadFn } from '../contracts';

/** STUB (0.4 U1): cannot upload. U2 replaces it. */
export const useUpload: UseUploadFn = () => ({ canUpload: false, upload: async () => undefined, adding: false });
