export const errorCatalog = {
  E_OFFLINE: { http: null, retryable: true, silent: false },
  E_AI_TIMEOUT: { http: 504, retryable: true, silent: false },
  E_AI_FORMAT: { http: 502, retryable: true, silent: false },
} as const;
