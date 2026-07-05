// netlify/functions/seb-api/seb-api.js
import { Buffer } from "buffer";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";

// ✅ Use /tmp for uploaded files (writable in Netlify Functions)
const UPLOADS_DIR = join("/tmp", "uploads");
const MESSAGES_FILE = join("/tmp", "messages.json");

// Ensure directories exist
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Initialize messages file if it doesn't exist
if (!existsSync(MESSAGES_FILE)) {
  writeFileSync(MESSAGES_FILE, JSON.stringify([]));
}

// Helper: parse multipart/form-data
async function parseMultipart(event) {
  const contentType = event.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);

  if (!boundaryMatch) {
    throw new Error("No boundary found in content-type");
  }

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

    if (partEnd === -1) {
      partEnd = body.length;
    }

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

// Generate random string
function generateRandomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Download file handler
async function handleDownloadFile(event) {
  try {
    const url = new URL(event.rawUrl);
    const filename = url.searchParams.get('filename');
    
    if (!filename) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Filename is required" }),
      };
    }

    const filePath = join(UPLOADS_DIR, filename);
    
    if (!existsSync(filePath)) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "File not found" }),
      };
    }

    const fileBuffer = readFileSync(filePath);
    const stats = statSync(filePath);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": stats.size.toString(),
      },
      body: fileBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Download failed", details: error.message }),
    };
  }
}
// Upload handler
async function handleUpload(event) {
  try {
    const parts = await parseMultipart(event);
    const filePart = parts.find((p) => p.name === "sebFile" && p.filename);

    if (!filePart) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No file uploaded" }),
      };
    }

    // Validate file extension
    const ext = filePart.filename.toLowerCase();
    if (![".seb", ".gz", ".xml"].some((e) => ext.endsWith(e))) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Only .seb, .gz, .xml files are allowed",
        }),
      };
    }

    // Generate filename: original + random 10 chars
    const baseName = filePart.filename.replace(/\.[^.]+$/, "");
    const extension = filePart.filename.includes(".") ? "." + filePart.filename.split(".").pop() : "";
    const randomStr = generateRandomString(10);
    const newFilename = `${baseName}_${randomStr}${extension}`;

    // Save file to /tmp/uploads
    const fullPath = join(UPLOADS_DIR, newFilename);
    writeFileSync(fullPath, filePart.content);

    console.log(`[seb-api] ✅ File saved to: ${fullPath}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "File uploaded successfully",
        filename: newFilename,
        originalName: filePart.filename,
        path: fullPath,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error("Upload error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Upload failed", details: error.message }),
    };
  }
}

// List uploaded files
function handleListFiles() {
  try {
    if (!existsSync(UPLOADS_DIR)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ files: [] }),
      };
    }

    const files = readdirSync(UPLOADS_DIR);
    const fileDetails = files.map((file) => {
      const path = join(UPLOADS_DIR, file);
      const stats = statSync(path);
      return {
        name: file,
        size: stats.size,
        modified: stats.mtime,
        timestamp: stats.mtime.toISOString(),
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ files: fileDetails }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to read files" }),
    };
  }
}

// Chat: Get messages
function handleGetMessages() {
  try {
    if (!existsSync(MESSAGES_FILE)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ messages: [] }),
      };
    }
    const data = readFileSync(MESSAGES_FILE, 'utf-8');
    const messages = JSON.parse(data);
    return {
      statusCode: 200,
      body: JSON.stringify({ messages }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to read messages" }),
    };
  }
}

// Chat: Send message
async function handleSendMessage(event) {
  try {
    const body = JSON.parse(event.body);
    const { text, sender } = body;

    if (!text || !sender) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Text and sender are required" }),
      };
    }

    let messages = [];
    if (existsSync(MESSAGES_FILE)) {
      const data = readFileSync(MESSAGES_FILE, 'utf-8');
      messages = JSON.parse(data);
    }

    const newMessage = {
      id: Date.now().toString(),
      text,
      sender,
      timestamp: new Date().toISOString(),
      isAdminReply: false,
      replyTo: null,
    };

    messages.push(newMessage);
    writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Message sent", data: newMessage }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send message" }),
    };
  }
}

// Admin: Reply to message
async function handleAdminReply(event) {
  try {
    const body = JSON.parse(event.body);
    const { messageId, replyText, sender } = body;

    if (!messageId || !replyText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Message ID and reply text are required" }),
      };
    }

    let messages = [];
    if (existsSync(MESSAGES_FILE)) {
      const data = readFileSync(MESSAGES_FILE, 'utf-8');
      messages = JSON.parse(data);
    }

    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Message not found" }),
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

    messages.push(reply);
    messages[messageIndex].replied = true;
    writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Reply sent", data: reply }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send reply" }),
    };
  }
}

// Main handler
export const handler = async (event, context) => {
  let path = event.path || event.rawPath || "";

  const functionPath = "/.netlify/functions/seb-api";
  if (path.startsWith(functionPath)) {
    path = path.substring(functionPath.length);
  }

  if (path.startsWith("/api")) {
    path = path.substring(4);
  }

  if (!path || path === "") {
    path = "/";
  }

  const method = event.httpMethod || event.requestContext?.http?.method || "GET";

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

  // Routes
  else if (method === "GET" && (path === "/download_file" || path === "/download_file/")) {
  response = await handleDownloadFile(event);
} if (method === "POST" && (path === "/upload_seb" || path === "/upload_seb/")) {
    response = await handleUpload(event);
  } else if (method === "GET" && (path === "/list_files" || path === "/list_files/")) {
    response = handleListFiles();
  } else if (method === "GET" && (path === "/messages" || path === "/messages/")) {
    response = handleGetMessages();
  } else if (method === "POST" && (path === "/send_message" || path === "/send_message/")) {
    response = await handleSendMessage(event);
  } else if (method === "POST" && (path === "/admin_reply" || path === "/admin_reply/")) {
    response = await handleAdminReply(event);
  } else if (path === "/" || path === "") {
    response = {
      statusCode: 200,
      body: JSON.stringify({
        service: "SEB Config Server (Netlify)",
        endpoints: {
          upload: 'POST /api/upload_seb (multipart/form-data, field: "sebFile")',
          list_files: "GET /api/list_files",
          messages: "GET /api/messages",
          send_message: "POST /api/send_message",
          admin_reply: "POST /api/admin_reply",
        },
      }),
    };
  } else {
    response = {
      statusCode: 404,
      body: JSON.stringify({ error: `Endpoint not found: ${path}` }),
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
