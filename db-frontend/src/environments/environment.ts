const runtimeApiBaseUrl =
  typeof window !== 'undefined'
    ? (window as Window & { __env?: { API_BASE_URL?: string } }).__env?.API_BASE_URL
    : undefined;

export const environment = {
  production: true,
  apiBaseUrl: runtimeApiBaseUrl || '/api'
};
