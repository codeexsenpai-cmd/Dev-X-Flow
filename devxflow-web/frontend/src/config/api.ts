/**
 * API Configuration
 * Centralized API URL configuration for environment-specific settings
 */

// Use Vite proxy in development, direct URL in production
export const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.PROD ? '' : '/api');

export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 
  (import.meta.env.PROD ? '' : 'http://localhost:5000');

// Helper for API calls with auth
export async function apiFetch(
  endpoint: string, 
  options: RequestInit = {},
  token?: string
): Promise<Response> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
}
