const axios = require('axios');
const FormData = require('form-data');

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

async function downloadWhatsAppMedia(mediaUrl) {
  try {
    console.log('📥 Downloading media from WhatsApp...');
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'WhatsApp/2.0',
        'Accept': '*/*'
      },
      timeout: 30000
    });
    console.log(`✅ Downloaded ${response.data.byteLength} bytes`);
    return Buffer.from(response.data);
  } catch (error) {
    console.error('❌ Failed to download WhatsApp media:', error.message);
    throw new Error(`WhatsApp media download failed: ${error.message}`);
  }
}

async function uploadMediaToGHL(mediaBuffer, messageType, contactId, accessToken, locationId, conversationId) {
  try {
    console.log(`📤 Uploading ${messageType} to GHL for location: ${locationId}...`);
    console.log(`📤 Using ${conversationId ? 'conversationId' : 'contactId'} for upload`);

    const ext = messageType === 'image' ? 'jpg' :
      messageType === 'video' ? 'mp4' :
        messageType === 'voice' ? 'ogg' :
          messageType === 'audio' ? 'mp3' : 'pdf';

    const contentType = messageType === 'image' ? 'image/jpeg' :
      messageType === 'video' ? 'video/mp4' :
        messageType === 'voice' ? 'audio/ogg' :
          messageType === 'audio' ? 'audio/mpeg' : 'application/pdf';

    const form = new FormData();
    form.append('fileAttachment', mediaBuffer, {
      filename: `media_${Date.now()}.${ext}`,
      contentType: contentType
    });

    if (conversationId) {
      form.append('conversationId', conversationId);
    } else if (contactId) {
      form.append('contactId', contactId);
    } else {
      throw new Error('Either conversationId or contactId is required for media upload');
    }

    const uploadResponse = await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages/upload',
      form,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          ...form.getHeaders()
        },
        maxContentLength: 10 * 1024 * 1024,
        timeout: 60000
      }
    );

    const uploadData = uploadResponse.data;
    console.log('📎 GHL attachment upload response:', JSON.stringify(uploadData));

    const uploadedFiles = uploadData.uploadedFiles;
    const attachmentUrl = uploadedFiles 
      ? Object.values(uploadedFiles)[0] 
      : uploadData.urls?.[0] || null;

    if (!attachmentUrl) {
      console.error('❌ No URL returned from GHL upload:', uploadData);
      throw new Error('GHL upload succeeded but no URL returned');
    }

    console.log(`✅ Media uploaded successfully: ${attachmentUrl}`);
    return { url: attachmentUrl, success: true };

  } catch (error) {
    if (error.response) {
      console.error('❌ GHL media upload failed:');
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data));
      throw new Error(`GHL upload failed (${error.response.status}): ${JSON.stringify(error.response.data)}`);
    }
    console.error('❌ GHL media upload error:', error.message);
    throw new Error(`GHL upload failed: ${error.message}`);
  }
}

async function processWhatsAppMedia(mediaUrl, messageType, contactId, accessToken, locationId) {
  try {
    const mediaBuffer = await downloadWhatsAppMedia(mediaUrl);
    const ghlMediaUrl = await uploadMediaToGHL(mediaBuffer, messageType, contactId, accessToken, locationId);
    return ghlMediaUrl;
  } catch (error) {
    console.error('❌ Media processing failed:', error.message);
    throw error;
  }
}

module.exports = {
  downloadWhatsAppMedia,
  uploadMediaToGHL,
  processWhatsAppMedia,
  getMediaMessageText
};