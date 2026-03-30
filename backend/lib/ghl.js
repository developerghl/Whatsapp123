/**
 * LeadConnector API utilities
 */

const axios = require('axios');

class GHLClient {
  constructor(accessToken, locationId = null) {
    this.accessToken = accessToken;
    this.locationId = locationId;
    this.baseURL = 'https://services.leadconnectorhq.com';
  }

  /**
   * Make authenticated request to GHL API
   */
  async request(method, endpoint, data = null) {
    const config = {
      method,
      url: `${this.baseURL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Version': '2021-07-28'
      }
    };

    if (data) {
      config.data = data;
    }

    if (this.locationId) {
      config.headers['Location-Id'] = this.locationId;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('GHL API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get all locations for the company
   */
  async getLocations() {
    return this.request('GET', '/locations');
  }

  /**
   * Get contacts for a location
   */
  async getContacts(limit = 50) {
    return this.request('GET', '/contacts', null, { limit });
  }

  /**
   * Add inbound message to GHL conversations
   */
  async addInboundMessage(data) {
    const payload = {
      type: "SMS",
      conversationProviderId: data.conversationProviderId,
      locationId: data.locationId,
      message: data.message,
      attachments: data.attachments || [],
      altId: data.altId
    };

    if (data.contactId) {
      payload.contactId = data.contactId;
    } else if (data.phone) {
      payload.phone = data.phone;
    }

    return this.request('POST', '/conversations/messages', payload);
  }

  /**
   * Get conversation provider details
   */
  async getConversationProvider(providerId) {
    return this.request('GET', `/conversationProviders/${providerId}`);
  }

  /**
   * Get conversations for a location
   */
  async getConversations(locationId, limit = 50) {
    return this.request('GET', `/conversations?locationId=${locationId}&limit=${limit}`);
  }

  /**
   * Get specific conversation
   */
  async getConversation(conversationId) {
    return this.request('GET', `/conversations/${conversationId}`);
  }

  /**
   * Get messages in a conversation
   */
  async getMessages(conversationId, limit = 50) {
    return this.request('GET', `/conversations/${conversationId}/messages?limit=${limit}`);
  }

  /**
   * Search conversations
   */
  async searchConversations(locationId, query) {
    return this.request('GET', `/conversations/search?locationId=${locationId}&q=${encodeURIComponent(query)}`);
  }

  /**
   * Get contact by ID
   */
  async getContact(contactId) {
    return this.request('GET', `/contacts/${contactId}`);
  }

  /**
   * Search contacts by phone number
   */
  async searchContacts(phoneNumber) {
    try {
      const response = await this.request('GET', `/contacts/search?phone=${phoneNumber}`);
      return response.contacts || [];
    } catch (error) {
      console.error('Error searching contacts:', error);
      return [];
    }
  }

  /**
   * Send message to GHL conversation
   */
  async sendMessage({ contactId, message, type = 'SMS' }) {
    const payload = {
      type,
      contactId,
      message,
      direction: 'inbound'
    };

    return this.request('POST', '/conversations/messages', payload);
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken, clientId, clientSecret) {
    const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', 
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        user_type: 'Company',
        redirect_uri: process.env.GHL_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );

    return response.data;
  }

  /**
   * Mint location-specific token from agency token
   */
  static async mintLocationToken(agencyToken, companyId, locationId) {
    const response = await axios.post('https://services.leadconnectorhq.com/oauth/locationToken', 
      {
        companyId,
        locationId
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Version': '2021-07-28',
          'Authorization': `Bearer ${agencyToken}`
        }
      }
    );

    return response.data;
  }
}

module.exports = GHLClient;
