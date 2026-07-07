// netlify/functions/seb-api.js
const { Buffer } = require("buffer");
const { getStore } = require('@netlify/blobs');

// Initialize persistent blob storage with manual configuration
let store;

function getBlobStore() {
  if (!store) {
    // Get site ID and token from environment variables
    const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_ACCESS_TOKEN;
    
    if (siteID && token) {
      store = getStore({
        name: 'seb-data',
        siteID: siteID,
        token: token
      });
    } else {
      // Fallback to automatic configuration (for Netlify environment)
      store = getStore('seb-data');
    }
  }
  return store;
}

async function getMessages() {
  try {
    const store = getBlobStore();
    const data = await store.get('messages.json');
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading messages:', error);
    return [];
  }
}

async function saveMessages(messages) {
  try {
    const store = getBlobStore();
    await store.set('messages.json', JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('Error saving messages:', error);
    throw error;
  }
}

// ============================================================
// EDIT MESSAGE
// ============================================================
async function handleEditMessage(event) {
  try {
    const body = JSON.parse(event.body);
    const { messageId, newText } = body;
    
    if (!messageId || !newText) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "Message ID and new text required" }) 
      };
    }

    let messages = await getMessages();
    const messageIndex = messages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) {
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: "Message not found" }) 
      };
    }

    // Update the message
    messages[messageIndex].text = newText;
    messages[messageIndex].edited = true;
    messages[messageIndex].editedAt = new Date().toISOString();
    
    await saveMessages(messages);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        message: "Message edited successfully",
        data: messages[messageIndex]
      }) 
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to edit message" }) 
    };
  }
}

// ============================================================
// DELETE MESSAGE
// ============================================================
async function handleDeleteMessage(event) {
  try {
    const body = JSON.parse(event.body);
    const { messageId } = body;
    
    if (!messageId) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "Message ID required" }) 
      };
    }

    let messages = await getMessages();
    const messageIndex = messages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) {
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: "Message not found" }) 
      };
    }

    // Remove the message
    messages.splice(messageIndex, 1);
    await saveMessages(messages);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Message deleted successfully" }) 
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to delete message" }) 
    };
  }
}

async function getNotifications() {
  try {
    const store = getBlobStore();
    const data = await store.get('notifications.json');
    return data ? JSON.parse(data) : { lastNotificationId: 0, notifications: [] };
  } catch (error) {
    console.error('Error loading notifications:', error);
    return { lastNotificationId: 0, notifications: [] };
  }
}

async function saveNotifications(notifications) {
  try {
    const store = getBlobStore();
    await store.set('notifications.json', JSON.stringify(notifications, null, 2));
  } catch (error) {
    console.error('Error saving notifications:', error);
    throw error;
  }
}

async function saveFile(filename, content) {
  try {
    const store = getBlobStore();
    const base64Content = content.toString('base64');
    await store.set(`files/${filename}`, base64Content);
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
}

async function getFile(filename) {
  try {
    const store = getBlobStore();
    const data = await store.get(`files/${filename}`);
    if (!data) return null;
    return Buffer.from(data, 'base64');
  } catch (error) {
    console.error('Error loading file:', error);
    return null;
  }
}

async function listFiles() {
  try {
    const store = getBlobStore();
    const items = await store.list({ prefix: 'files/' });
    const fileDetails = [];
    
    for (const item of items) {
      const filename = item.key.replace('files/', '');
      fileDetails.push({
        name: filename,
        size: 0,
        timestamp: new Date().toISOString()
      });
    }
    
    return fileDetails;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
}

// ============================================================
// ORIGINAL FUNCTIONS (UNCHANGED)
// ============================================================

function generateRandomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Parse multipart/form-data
async function parseMultipart(event) {
  const contentType = event.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) throw new Error("No boundary found");

  const boundary = boundaryMatch[1];
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : Buffer.from(event.body, "utf-8");

  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = 0;
  let end = body.indexOf(delimiter, start);

  while (end !== -1 && start < body.length) {
    const partStart = end + delimiter.length;
    let partEnd = body.indexOf(delimiter, partStart);
    if (partEnd === -1) partEnd = body.length;

    const part = body.slice(partStart, partEnd);
    if (part.length > 0) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const headers = part.slice(0, headerEnd).toString();
        const content = part.slice(headerEnd + 4);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) {
          parts.push({
            name: nameMatch[1],
            filename: filenameMatch ? filenameMatch[1] : null,
            content: content,
          });
        }
      }
    }
    start = partEnd + delimiter.length;
    end = body.indexOf(delimiter, start);
  }
  return parts;
}

// ============================================================
// HANDLERS
// ============================================================

// Upload handler
async function handleUpload(event) {
  try {
    const parts = await parseMultipart(event);
    const filePart = parts.find((p) => p.name === "sebFile" && p.filename);
    if (!filePart) {
      return { statusCode: 400, body: JSON.stringify({ error: "No file uploaded" }) };
    }

    const ext = filePart.filename.toLowerCase();
    if (![".seb", ".gz", ".xml"].some((e) => ext.endsWith(e))) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid file type" }) };
    }

    const baseName = filePart.filename.replace(/\.[^.]+$/, "");
    const extension = filePart.filename.includes(".") ? "." + filePart.filename.split(".").pop() : "";
    const newFilename = `${baseName}_${generateRandomString(10)}${extension}`;
    
    await saveFile(newFilename, filePart.content);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "File uploaded",
        filename: newFilename,
        originalName: filePart.filename,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Upload failed", details: error.message }) 
    };
  }
}

// List files
async function handleListFiles() {
  try {
    const files = await listFiles();
    return { statusCode: 200, body: JSON.stringify({ files }) };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Unable to read files" }) 
    };
  }
}

// Get messages
async function handleGetMessages(event) {
  try {
    const messages = await getMessages();
    
    const url = new URL(event.rawUrl || `http://localhost${event.path || ''}`);
    const lastSeen = parseInt(url.searchParams.get('lastSeen') || '0');
    
    const notificationState = await getNotifications();
    const newMessages = messages.filter(m => parseInt(m.id) > lastSeen);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        messages, 
        lastNotificationId: notificationState.lastNotificationId,
        newMessages: newMessages.length
      }) 
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to read messages" }) 
    };
  }
}

// Send message
async function handleSendMessage(event) {
  try {
    const body = JSON.parse(event.body);
    const { text, sender, image } = body;
    if (!text && !image) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "Text or image required" }) 
      };
    }

    let messages = await getMessages();

    const newMessage = {
      id: Date.now().toString(),
      text: text || '',
      sender: sender || 'admin',
      timestamp: new Date().toISOString(),
      isAdminReply: sender === 'admin' || false,
    };
    
    // Handle image data
    if (image) {
      newMessage.image = image;
      newMessage.imageType = image.split(';')[0].split('/')[1] || 'png';
    }
    
    messages.push(newMessage);
    await saveMessages(messages);
    
    let notificationState = await getNotifications();
    notificationState.lastNotificationId = parseInt(newMessage.id);
    notificationState.notifications.push({
      id: newMessage.id,
      sender: sender || 'admin',
      text: text ? text.substring(0, 100) : '[Image]',
      timestamp: newMessage.timestamp,
      hasImage: !!image
    });
    if (notificationState.notifications.length > 50) {
      notificationState.notifications = notificationState.notifications.slice(-50);
    }
    await saveNotifications(notificationState);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Message sent", data: newMessage }) 
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to send message" }) 
    };
  }
}

// Admin reply
async function handleAdminReply(event) {
  try {
    const body = JSON.parse(event.body);
    const { messageId, replyText, sender, image } = body;
    if (!messageId || !replyText) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "Message ID and reply text required" }) 
      };
    }

    let messages = await getMessages();

    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: "Message not found" }) 
      };
    }

    const reply = {
      id: Date.now().toString(),
      text: replyText,
      sender: sender || 'admin',
      timestamp: new Date().toISOString(),
      isAdminReply: true,
      replyTo: messageId,
    };
    
    // Handle image data
    if (image) {
      reply.image = image;
      reply.imageType = image.split(';')[0].split('/')[1] || 'png';
    }
    
    messages.push(reply);
    messages[messageIndex].replied = true;
    await saveMessages(messages);
    
    let notificationState = await getNotifications();
    notificationState.lastNotificationId = parseInt(reply.id);
    notificationState.notifications.push({
      id: reply.id,
      sender: 'admin',
      text: replyText.substring(0, 100),
      timestamp: reply.timestamp,
      isAdminReply: true,
      replyTo: messageId,
      hasImage: !!image
    });
    if (notificationState.notifications.length > 50) {
      notificationState.notifications = notificationState.notifications.slice(-50);
    }
    await saveNotifications(notificationState);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Reply sent", data: reply }) 
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to send reply" }) 
    };
  }
}

// Download file
async function handleDownloadFile(event) {
  try {
    const url = new URL(event.rawUrl);
    const filename = url.searchParams.get('filename');
    if (!filename) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "Filename required" }) 
      };
    }

    const fileBuffer = await getFile(filename);
    if (!fileBuffer) {
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: "File not found" }) 
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
      body: fileBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Download failed", details: error.message }) 
    };
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

exports.handler = async (event, context) => {
  let path = event.path || event.rawPath || "";
  const functionPath = "/.netlify/functions/seb-api";
  if (path.startsWith(functionPath)) path = path.substring(functionPath.length);
  if (path.startsWith("/api")) path = path.substring(4);
  if (!path || path === "") path = "/";

  const method = event.httpMethod || "GET";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (method === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  let response;

  console.log(`[seb-api] Method: ${method}, Path: ${path}`);
  if (method === "POST" && path === "/upload_seb") {
    response = await handleUpload(event);
  } else if (method === "GET" && path === "/list_files") {
    response = await handleListFiles();
  } else if (method === "GET" && path === "/messages") {
    response = await handleGetMessages(event);
  } else if (method === "POST" && path === "/send_message") {
    response = await handleSendMessage(event);
  } else if (method === "POST" && path === "/admin_reply") {
    response = await handleAdminReply(event);
  } else if (method === "GET" && path === "/download_file") {
    response = await handleDownloadFile(event);
  } else if (method === "POST" && path === "/edit_message") {
    response = await handleEditMessage(event);
  } else if (method === "POST" && path === "/delete_message") {
    response = await handleDeleteMessage(event);
  } else {
    response = {
      statusCode: 200,
      body: JSON.stringify({
        service: "SEB API",
        endpoints: {
          upload: "POST /api/upload_seb",
          list_files: "GET /api/list_files",
          messages: "GET /api/messages",
          send_message: "POST /api/send_message",
          admin_reply: "POST /api/admin_reply",
          download_file: "GET /api/download_file?filename=example.seb",
        },
      }),
    };
  }

  return {
    ...response,
    headers: {
      ...headers,
      ...(response.headers || {}),
    },
  };
};
