const fs = require('fs').promises;
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const DatabaseService = require('./database');
const db = new DatabaseService();

class GmailService {
  constructor() {
    this.SCOPES = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ];
    this.TOKEN_PATH = path.join(process.cwd(), 'token.json');
    this.CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
  }

  // Load saved credentials if they exist
  async loadSavedCredentialsIfExist() {
    try {
      const token = await db.findToken();
      console.log('Loaded token from database:', token);
      // const content = await fs.readFile(this.TOKEN_PATH);
      // const credentials = JSON.parse(content);
      // console.log('Parsed credentials:', credentials);
      return google.auth.fromJSON(token);
    } catch (err) {
      console.log("error", err);
      return null;
    }
  }

  // Save credentials for future use
  async saveCredentials(client) {
    const content = await fs.readFile(this.CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(this.TOKEN_PATH, payload);
  }

  // Authorize and get Gmail client
  async authorize() {
    let client = await this.loadSavedCredentialsIfExist();
    console.log('Client after loading saved credentials:', client);
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: this.SCOPES,
      keyfilePath: this.CREDENTIALS_PATH,
    });
    if (client?.credentials) {
      await this.saveCredentials(client);
    }
    return client;
  }

  // Get Gmail service instance
  async getGmailService() {
    const auth = await this.authorize();
    return google.gmail({ version: 'v1', auth });
  }

  // Read forwarded emails
  async getForwardedEmails() {
    const gmail = await this.getGmailService();
    
    try {
      // Search for forwarded emails
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'subject:Fwd: is:unread',
        maxResults: 10
      });      

      const messages = res.data.messages || [];
      console.log(`Found ${messages.length} forwarded emails`);

      const emails = [];
      
      for (const message of messages) {
        // Get full message details
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });

        console.log('=== EMAIL MESSAGE DETAILS ===');
        console.log('Message ID:', message.id);
        // console.log('Payload structure:', JSON.stringify(msg.data.payload, null, 2));

        // Extract email data
        const headers = msg.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        
        console.log('From:', from);
        console.log('Subject:', subject);
        console.log('Date:', date);
        
        // Extract sender email
        const emailMatch = from.match(/<(.+?)>/) || [null, from];
        const senderEmail = emailMatch[1];

        // Get email body with detailed logging
        console.log('=== EXTRACTING EMAIL BODY ===');
        const body = this.extractBody(msg.data.payload);
        console.log('Extracted body length:', body.length);
        console.log('Extracted body content:');
        console.log('--- START BODY ---');
        // console.log(body);
        console.log('--- END BODY ---');
        
        // Extract links from body
        const links = this.extractLinks(body);
        
        // Remove links from body to get clean content
        const cleanedBody = this.removeLinksFromBody(body);

        emails.push({
          id: message.id,
          from: from,
          senderEmail: senderEmail,
          subject: subject,
          date: date,
          body: body,
          cleanedBody: cleanedBody,
          links: links
        });

        // Mark as read
        await gmail.users.messages.modify({
          userId: 'me',
          id: message.id,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
      }

      return emails;
    } catch (error) {
      console.error('Error fetching emails:', error);
      throw error;
    }
  }

  // Extract body from email payload
  extractBody(payload) {
    let body = '';
    console.log('Extracting body from payload with mimeType:', payload.mimeType);
    
    if (payload.parts) {
      console.log('Email has', payload.parts.length, 'parts');
      for (let i = 0; i < payload.parts.length; i++) {
        const part = payload.parts[i];
        console.log(`Part ${i + 1}: mimeType=${part.mimeType}, hasData=${!!part.body?.data}, hasSubParts=${!!part.parts}`);
        
        if (part.mimeType === 'text/plain' && part.body.data) {
          console.log('Found text/plain part, extracting...');
          const plainText = Buffer.from(part.body.data, 'base64').toString('utf-8');
          console.log('Plain text content length:', plainText.length);
          console.log('Plain text preview (first 200 chars):', plainText.substring(0, 200));
          body += plainText;
        } else if (part.mimeType === 'text/html' && part.body.data && !body) {
          console.log('Found text/html part, extracting...');
          // Use HTML if plain text not available
          const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
          console.log('HTML content length:', html.length);
          console.log('HTML preview (first 200 chars):', html.substring(0, 200));
          // Simple HTML to text (you might want a proper HTML parser)
          body = html.replace(/<[^>]*>/g, '');
          console.log('HTML after tag removal length:', body.length);
        } else if (part.parts) {
          console.log('Part has nested parts, recursing...');
          // Recursive for nested parts
          body += this.extractBody(part);
        }
      }
    } else if (payload.body?.data) {
      console.log('Single part email, extracting body data...');
      const singleBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      console.log('Single body content length:', singleBody.length);
      console.log('Single body preview (first 200 chars):', singleBody.substring(0, 200));
      body = singleBody;
    } else {
      console.log('No body data found in payload');
    }
    
    console.log('Final extracted body length:', body.length);
    return body;
  }

  // Remove links from email body
  removeLinksFromBody(body) {
    if (!body) return body;
    
    console.log('=== REMOVING LINKS FROM BODY ===');
    console.log('Original body length:', body.length);
    
    // Regex patterns to match different types of links
    const patterns = [
      // HTTP/HTTPS URLs
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
      // Email addresses
      /mailto:[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
      // www. links without http
      /www\.[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
      // Standalone email addresses
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi
    ];
    
    let cleanedBody = body;
    let totalLinksRemoved = 0;
    
    patterns.forEach((pattern, index) => {
      const matches = cleanedBody.match(pattern) || [];
      console.log(`Pattern ${index + 1} found ${matches.length} matches`);
      if (matches.length > 0) {
        console.log('Sample matches:', matches.slice(0, 3)); // Show first 3 matches
      }
      cleanedBody = cleanedBody.replace(pattern, '');
      totalLinksRemoved += matches.length;
    });
    
    // Clean up extra whitespace and line breaks left after removing links
    cleanedBody = cleanedBody
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple line breaks with double line break
      .replace(/\s{3,}/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    console.log('Total links removed:', totalLinksRemoved);
    console.log('Cleaned body length:', cleanedBody.length);
    console.log('Cleaned body:');
    // console.log(cleanedBody);

    return cleanedBody;
  }

  // Extract links from email body
  extractLinks(body) {
    const linkRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    const links = body.match(linkRegex) || [];
    
    // Filter out common non-article links
    return links.filter(link => {
      const lowercaseLink = link.toLowerCase();
      return !lowercaseLink.includes('unsubscribe') &&
             !lowercaseLink.includes('mailto:') &&
             !lowercaseLink.includes('preferences') &&
             !lowercaseLink.includes('email-settings');
    });
  }

  // Send reply email
  async sendReply(to, subject, messageId) {
    const gmail = await this.getGmailService();
    
    // Create email content
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      `<html>
        <body>
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>✅ Newsletter Received!</h2>
            <p>Hello!</p>
            <p>Thank you for forwarding "<strong>${subject.replace('Fwd: ', '')}</strong>" to our newsletter digest service.</p>
            
            <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0;"><strong>What happens next:</strong></p>
              <ul>
                <li>We'll extract article links from your newsletter</li>
                <li>Generate 100-word summaries for each article</li>
                <li>Add them to your personal digest</li>
              </ul>
            </div>
            
            <p>You'll receive another email once processing is complete with a link to your digest.</p>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              This is an automated response from Newsletter Digest<br>
              If you have questions, reply to this email.
            </p>
          </div>
        </body>
      </html>`
    ];
    
    const message = messageParts.join('\n');
    
    // The body needs to be base64url encoded
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    try {
      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });
      
      console.log('Reply sent:', res.data);
      return res.data;
    } catch (error) {
      console.error('Error sending reply:', error);
      throw error;
    }
  }

  async sendFinalDigestReply(to, subject, digestLink) {
  const gmail = await this.getGmailService();
  // Create email content
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    `<html>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>📰 Your Newsletter Digest is Ready!</h2>
          <p>Hello!</p>
          <p>Your newsletter "<strong>${subject.replace('Fwd: ', '')}</strong>" has been processed.</p>
          <p>
            <a href="${digestLink}" style="display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:4px;">
              View Your Digest
            </a>
          </p>
          <p>You can access all article summaries and links in your personal digest above.</p>
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            This is an automated message from Newsletter Digest.<br>
            If you have questions, reply to this email.
          </p>
        </div>
      </body>
    </html>`
  ];

  const message = messageParts.join('\n');

  // The body needs to be base64url encoded
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log('Final digest reply sent:', res.data);
    return res.data;
  } catch (error) {
    console.error('Error sending final digest reply:', error);
    throw error;
  }
}
}

module.exports = GmailService;