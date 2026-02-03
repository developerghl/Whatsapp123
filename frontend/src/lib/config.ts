// Backend API configuration
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.octendr.com';

// API endpoints
export const API_ENDPOINTS = {
  // GHL endpoints
  connectSubaccount: `${API_BASE_URL}/admin/ghl/connect-subaccount`,
  getSubaccounts: `${API_BASE_URL}/admin/ghl/subaccounts`,
  createSubaccount: `${API_BASE_URL}/admin/ghl/create-subaccount`,
  debugSubaccounts: `${API_BASE_URL}/admin/ghl/debug-subaccounts`,
  
  // Session endpoints
  createSession: (locationId: string) => `${API_BASE_URL}/ghl/location/${locationId}/session`,
  getSession: (locationId: string) => `${API_BASE_URL}/ghl/location/${locationId}/session`,
  resetSession: (locationId: string) => `${API_BASE_URL}/ghl/location/${locationId}/session/reset`,
  logoutSession: (locationId: string) => `${API_BASE_URL}/ghl/location/${locationId}/session/logout`,
  
  // Provider endpoints
  providerUI: (locationId: string, companyId?: string) => {
    const params = new URLSearchParams({ locationId });
    if (companyId) params.append('companyId', companyId);
    return `${API_BASE_URL}/ghl/provider?${params.toString()}`;
  },
  
  // Stripe subscription endpoints
  createCheckout: `${API_BASE_URL}/api/stripe/create-checkout`,
  
  // User subscription info
  subscriptionInfo: `${API_BASE_URL}/api/user/subscription-info`,
  
  // Subscription management
  cancelSubscription: `${API_BASE_URL}/api/stripe/cancel-subscription`,
  customerPortal: `${API_BASE_URL}/api/stripe/customer-portal`,
  
  // Subaccount settings endpoints
  getSubaccountSettings: (ghlAccountId: string) => `${API_BASE_URL}/admin/subaccount/${ghlAccountId}/settings`,
  updateSubaccountSettings: (ghlAccountId: string) => `${API_BASE_URL}/admin/subaccount/${ghlAccountId}/settings`,
  getSubaccountAnalytics: (ghlAccountId: string) => `${API_BASE_URL}/admin/subaccount/${ghlAccountId}/analytics`,
  getSubaccountSessions: (ghlAccountId: string) => `${API_BASE_URL}/admin/subaccount/${ghlAccountId}/sessions`,
  activateSession: (ghlAccountId: string, sessionId: string) => `${API_BASE_URL}/admin/subaccount/${ghlAccountId}/sessions/${sessionId}/activate`
};

// Helper function to make authenticated API calls
// Uses custom auth system with user ID from localStorage
export const apiCall = async (url: string, options: RequestInit = {}) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  
  // Get user from localStorage (custom auth system)
  if (typeof window !== 'undefined') {
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        const user = JSON.parse(userData);
        // Add user ID as custom header for backend to verify
        headers['X-User-ID'] = user.id;
        console.log('🔑 Sending request with user ID:', user.id);
      } else {
        console.warn('⚠️ No user data in localStorage');
      }
    } catch (e) {
      console.error('Failed to get user data:', e);
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Include cookies in request
  });
};
