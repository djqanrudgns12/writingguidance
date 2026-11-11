export const errorCatalog = {
  E_OFFLINE: { http: null, retryable: true, silent: false },
  E_EXTRA_IN_CODE: { http: 500, retryable: false, silent: false },
} as const;
