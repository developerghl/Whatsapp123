const axios = require('axios');
const FormData = require('form-data');
const mime = require('mime-types');

// Helper function for media message text
function getMediaMessageText(messageType) {
  const messages = {
    'image': '🖼️ Image received',
    'voice': '🎵 Voice note received',
    'audio': '🎵 Audio file received',
    'video': '🎥 Video received',
    'document': '📄 Document received'
  };
  return messages[messageType] || '📎 Media received';
}

/**
 * Downloads media from WhatsApp encrypted URL
 * @param {string} mediaUrl - WhatsApp encrypted media URL
 * @returns {Promise<Buffer>} - Media file buffer
 */
async function downloadWhatsAppMedia(mediaUrl) {
  try {
    console.log('📥 Downloading media from WhatsApp...');
    
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'WhatsApp/2.0',
        'Accept': '*/*'
      },
      timeout: 30000 // 30 second timeout
    });
    
    console.log(`✅ Downloaded ${response.data.byteLength} bytes`);
    return Buffer.from(response.data);
    
  } catch (error) {
    console.error('❌ Failed to download WhatsApp media:', error.message);
    throw new Error(`WhatsApp media download failed: ${error.message}`);
  }
}

/**
 * Uploads media to GHL
 * @param {Buffer} mediaBuffer - Media file buffer
 * @param {string} messageType - Type: 'image', 'voice', 'video', 'document'
 * @param {string} contactId - GHL contact ID
 * @param {string} accessToken - GHL access token
 * @param {string} locationId - GHL location ID
 * @returns {Promise<string>} - GHL media URL
 */
async function uploadMediaToGHL(mediaBuffer, messageType, contactId, accessToken, locationId, conversationId) {
  try {
    console.log(`📤 Uploading ${messageType} to GHL for location: ${locationId}...`);

    // Step 1: Upload to GHL conversation attachment endpoint
    const form = new FormData();
    form.append('fileAttachment', mediaBuffer, {
      filename: `media_${Date.now()}.${messageType === 'image' ? 'jpg' : 
                 messageType === 'video' ? 'mp4' : 
                 messageType === 'audio' ? 'mp3' : 'pdf'}`,
      contentType: messageType === 'image' ? 'image/jpeg' : 
                   messageType === 'video' ? 'video/mp4' : 
                   messageType === 'audio' ? 'audio/mp3' : 'application/pdf'
    });
    form.append('conversationId', conversationId);

    const uploadResponse = await fetch(
      'https://services.leadconnectorhq.com/conversations/messages/upload',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          ...form.getHeaders()
        },
        body: form
      }
    );

    const uploadData = await uploadResponse.json();
    console.log('📎 GHL attachment upload response:', uploadData);

    // Step 2: Return the URL
    const attachmentUrl = uploadData.uploadedFiles?.[0] || uploadData.urls?.[0];
    return { url: attachmentUrl, success: true };

  } catch (error) {
    console.error('❌ GHL media upload failed:');
    console.error('Message:', error.message);
    throw new Error(`GHL upload failed: ${error.message}`);
  }
}

/**
 * Process WhatsApp media and upload to GHL
 * @param {string} mediaUrl - WhatsApp media URL
 * @param {string} messageType - Message type
 * @param {string} contactId - GHL contact ID
 * @param {string} accessToken - GHL access token
 * @param {string} locationId - GHL location ID
 * @returns {Promise<string>} - GHL media URL
 */
async function processWhatsAppMedia(mediaUrl, messageType, contactId, accessToken, locationId) {
  try {
    // Step 1: Download from WhatsApp
    const mediaBuffer = await downloadWhatsAppMedia(mediaUrl);
    
    // Step 2: Upload to GHL
    const ghlMediaUrl = await uploadMediaToGHL(
      mediaBuffer, 
      messageType, 
      contactId, 
      accessToken,
      locationId
    );
    
    return ghlMediaUrl;
    
  } catch (error) {
    console.error('❌ Media processing failed:', error.message);
    throw error;
  }
}

module.exports = {
  downloadWhatsAppMedia,
  uploadMediaToGHL,
  processWhatsAppMedia
};
