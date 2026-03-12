const FormData = require('form-data');

async function uploadMediaToGHL(mediaBuffer, messageType, contactId, accessToken, locationId, conversationId) {
  try {
    console.log(`📤 Uploading ${messageType} to GHL for location: ${locationId}...`);

    const form = new FormData();
    form.append('fileAttachment', mediaBuffer, {
      filename: `media_${Date.now()}.${messageType === 'image' ? 'jpg' : 
                 messageType === 'video' ? 'mp4' : 
                 messageType === 'audio' ? 'mp3' : 'pdf'}`,
      contentType: messageType === 'image' ? 'image/jpeg' : 
                   messageType === 'video' ? 'video/mp4' : 
                   messageType === 'audio' ? 'audio/mp3' : 'application/pdf'
    });
    
    // GHL docs: "One of conversationId or contactId must be provided"
    if (conversationId) {
      form.append('conversationId', conversationId);
    } else if (contactId) {
      form.append('contactId', contactId);
    } else {
      throw new Error('Either conversationId or contactId is required for media upload');
    }

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

    const attachmentUrl = uploadData.uploadedFiles?.[0] || uploadData.urls?.[0];
    return { url: attachmentUrl, success: true };

  } catch (error) {
    console.error('❌ GHL media upload failed:');
    console.error('Message:', error.message);
    throw new Error(`GHL upload failed: ${error.message}`);
  }
}

module.exports = {
  uploadMediaToGHL
};