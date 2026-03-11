async function uploadMediaToGHL(mediaBuffer, messageType, contactId, accessToken, locationId, conversationId) {
  try {
    console.log(`📤 Uploading ${messageType} to GHL for location: ${locationId}...`);

    // If no conversationId, fetch it from contact
    if (!conversationId && contactId) {
      try {
        console.log(`🔍 No conversationId provided, fetching from contact: ${contactId}`);
        const searchRes = await fetch(
          `https://services.leadconnectorhq.com/conversations/search?contactId=${contactId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Version': '2021-07-28',
              'Content-Type': 'application/json'
            }
          }
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.conversations && searchData.conversations.length > 0) {
            conversationId = searchData.conversations[0].id;
            console.log(`✅ Found conversationId: ${conversationId}`);
          }
        }
      } catch (convError) {
        console.error(`❌ Error fetching conversationId:`, convError.message);
      }
    }

    if (!conversationId) {
      throw new Error('conversationId is required for media upload and could not be resolved');
    }

    // Upload to GHL conversation attachment endpoint
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

    const attachmentUrl = uploadData.uploadedFiles?.[0] || uploadData.urls?.[0];
    return { url: attachmentUrl, success: true };

  } catch (error) {
    console.error('❌ GHL media upload failed:');
    console.error('Message:', error.message);
    throw new Error(`GHL upload failed: ${error.message}`);
  }
}