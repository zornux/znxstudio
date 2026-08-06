import type { ZnxStudioApi } from '../shared/types';

declare global {
  interface Window {
    /** Privileged bridge exposed by the preload script. */
    znxstudio: ZnxStudioApi;
  }
}

export {};
