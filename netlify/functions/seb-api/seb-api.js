// netlify/functions/seb-api/seb-api.js
// Main entry point for all API routes

import { Buffer } from 'buffer';
import { createReadStream, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIGS_DIR = join(__dirname, '..', '..', '..', 'configs');

// Ensure configs directory exists
if (!existsSync(CONFIGS_DIR)) {
  mkdirSync(CONFIGS_DIR, { recursive: true });
}

// Create dummy patcher file if it doesn't exist
const PATCHER_PATH = join(CONFIGS_DIR, 'seb_patch.exe');
if (!existsSync(PATCHER_PATH)) {
  writeFileSync(PATCHER_PATH, 'SEB Patcher v2.0 – dummy executable');
}

// Helper: parse multipart/form-data
async function parseMultipart(event) {
  const boundary = event.headers['content-type']?.split('boundary=')[1];
  if (!boundary) throw new Error('No boundary found');

  const body = event.isBase64Encoded 
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body);

  const parts = [];
  const delimiter = `--${boundary}`;
  const delimiterEnd = `--${boundary}--`;
  
  let start = 0;
  let end = body.indexOf(delimiter, start);
  
  while (end !== -1 && start < body.length) {
    const partStart = end + delimiter.length;
    const partEnd = body.indexOf(delimiter, partStart);
    const part = body.slice(partStart, partEnd === -1 ? body.length : partEnd);
    
    if (part.length > 0) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = part.slice(0, headerEnd).toString();
        const content = part.slice(headerEnd + 4);
        
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        
        if (nameMatch) {
          parts.push({
            name: nameMatch[1],
            filename: filenameMatch ? filenameMatch[1] : null,
            content: content
          });
        }
      }
    }
    
    start = partEnd + delimiter.length;
    end = body.indexOf(delimiter, start);
  }
  
  return parts;
}

// Upload handler
async function handleUpload(event) {
  try {
    const parts = await parseMultipart(event);
    const filePart = parts.find(p => p.name === 'sebFile' && p.filename);
    
    if (!filePart) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No file uploaded' })
      };
    }

    // Validate file extension
    const ext = filePart.filename.toLowerCase();
    if (!['.seb', '.gz', '.xml'].some(e => ext.endsWith(e))) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Only .seb, .gz, .xml files are allowed' })
      };
    }

    // Generate unique filename
    let filename = filePart.filename;
    const targetPath = join(CONFIGS_DIR, filename);
    if (existsSync(targetPath)) {
      const base = filename.replace(/\.[^.]+$/, '');
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
      filename = `${base}-${Date.now()}${ext}`;
    }

    // Save file
    const fullPath = join(CONFIGS_DIR, filename);
    writeFileSync(fullPath, filePart.content);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'File uploaded successfully',
        filename: filename,
        path: fullPath
      })
    };
  } catch (error) {
    console.error('Upload error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Upload failed', details: error.message })
    };
  }
}

// Download handler
function handleDownload() {
  try {
    const patchPath = join(CONFIGS_DIR, 'seb_patch.exe');
    
    if (!existsSync(patchPath)) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Patcher file not found' })
      };
    }

    // Read file and return as base64
    const fileBuffer = createReadStream(patchPath);
    let fileData = '';
    
    return new Promise((resolve) => {
      fileBuffer.on('data', (chunk) => {
        fileData += chunk.toString('base64');
      });
      
      fileBuffer.on('end', () => {
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="seb_patch.exe"'
          },
          body: fileData,
          isBase64Encoded: true
        });
      });
      
      fileBuffer.on('error', (err) => {
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: 'Download failed', details: err.message })
        });
      });
    });
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Download failed', details: error.message })
    };
  }
}

// List configs handler
function handleList() {
  try {
    const files = readdirSync(CONFIGS_DIR);
    return {
      statusCode: 200,
      body: JSON.stringify({ files })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unable to read configs' })
    };
  }
}

// Main handler
export const handler = async (event, context) => {
  const path = event.path.replace('/.netlify/functions/seb-api', '');
  const method = event.httpMethod;

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  let response;

  // Route handling
  if (method === 'POST' && path === '/upload_seb') {
    response = await handleUpload(event);
  } else if (method === 'GET' && path === '/download_seb_patch') {
    response = await handleDownload();
  } else if (method === 'GET' && path === '/list_configs') {
    response = handleList();
  } else if (path === '/' || path === '') {
    response = {
      statusCode: 200,
      body: JSON.stringify({
        service: 'SEB Config Server (Netlify)',
        endpoints: {
          upload: 'POST /upload_seb (multipart/form-data, field: "sebFile")',
          download: 'GET /download_seb_patch',
          list: 'GET /list_configs'
        }
      })
    };
  } else {
    response = {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' })
    };
  }

  return {
    ...response,
    headers: {
      ...headers,
      ...(response.headers || {})
    }
  };
};
