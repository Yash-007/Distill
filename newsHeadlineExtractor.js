const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

class NewsHeadlineExtractor {
  constructor() {
    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent extraction
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
      }
    });

    // Configurable prompt for extracting news headlines
    this.headlineExtractionPrompt = `
You are a news headline extraction expert. Your task is to analyze newsletter content and extract only legitimate news headlines.

INSTRUCTIONS:
1. Extract ONLY actual news headlines or content that could be legitimate news headlines
2. IGNORE and DO NOT include:
   - Advertisements or promotional content
   - Product announcements from companies (unless major tech/business news)
   - Marketing messages
   - Subscription offers
   - Social media posts
   - Event promotions
   - Job postings
   - Personal opinions or blog posts
   - Newsletter introductions or conclusions
   - Unsubscribe links or footer content

3. Format your response as a numbered list with one headline per line
4. If no legitimate news headlines are found, respond with: "No news headlines found"

Newsletter Content to analyze:
`;
  }

  // Update the headline extraction prompt
  updatePrompt(newPrompt) {
    this.headlineExtractionPrompt = newPrompt;
    console.log('News headline extraction prompt updated');
    return {
      success: true,
      message: 'Prompt updated successfully'
    };
  }

  // Get current prompt
  getCurrentPrompt() {
    return this.headlineExtractionPrompt;
  }

  // Extract news headlines from email content
  async extractNewsHeadlines(cleanedBody, subject = '', emailFrom = '') {
    try {
      console.log('Extracting news headlines with Gemini AI...');
      console.log('Content length:', cleanedBody.length);
      console.log('Subject:', subject);
      console.log('From:', emailFrom);
      
      if (!cleanedBody || cleanedBody.trim().length === 0) {
        console.log('No content to analyze');
        return {
          success: false,
          error: 'No content provided for analysis',
          headlines: []
        };
      }

      // Prepare the full prompt with context
      const fullPrompt = `
${this.headlineExtractionPrompt}

Email Subject: ${subject}
Email From: ${emailFrom}

Content:
${cleanedBody}

---
Extract news headlines from the above content (respond with numbered list or "No news headlines found"):
      `.trim();

      console.log('Sending to Gemini API...');
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const extractedText = response.text();

      console.log('Gemini response received');
      console.log('Raw response:', extractedText);

      // Process the response to extract individual headlines
      const headlines = this.parseHeadlines(extractedText);

      console.log(`Extracted ${headlines.length} news headlines`);
      
      return {
        success: true,
        headlines: headlines,
        rawResponse: extractedText,
        metadata: {
          originalContentLength: cleanedBody.length,
          subject: subject,
          emailFrom: emailFrom,
          extractedAt: new Date().toISOString(),
          headlinesCount: headlines.length
        }
      };

    } catch (error) {
      console.error('Error extracting headlines with Gemini:', error);
      return {
        success: false,
        error: error.message || 'Failed to extract headlines with AI',
        headlines: [],
        rawResponse: null
      };
    }
  }

  // Parse headlines from AI response
  parseHeadlines(responseText) {
    if (!responseText || responseText.trim().toLowerCase().includes('no news headlines found')) {
      return [];
    }

    // Split by lines and clean up
    const lines = responseText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => {
        // Remove common non-headline patterns
        const lowercaseLine = line.toLowerCase();
        return !lowercaseLine.includes('extract') &&
               !lowercaseLine.includes('headline') &&
               !lowercaseLine.includes('analysis') &&
               !lowercaseLine.includes('content') &&
               !lowercaseLine.includes('newsletter') &&
               !line.startsWith('---') &&
               !line.startsWith('===') &&
               line.length > 10; // Minimum headline length
      });

    // Clean up bullet points, numbers, and formatting
    const cleanedHeadlines = lines.map(line => {
      return line
        .replace(/^[-•*]\s*/, '') // Remove bullet points
        .replace(/^\d+\.\s*/, '') // Remove numbered lists
        .replace(/^[\d\w]+\)\s*/, '') // Remove numbered lists with parentheses
        .replace(/^\**/, '') // Remove leading asterisks
        .replace(/\**$/, '') // Remove trailing asterisks
        .replace(/^["']/, '') // Remove leading quotes
        .replace(/["']$/, '') // Remove trailing quotes
        .trim();
    }).filter(line => line.length > 5); // Filter very short lines

    return cleanedHeadlines;
  }

  // Process multiple emails and extract all headlines
  async extractHeadlinesFromMultipleEmails(emails) {
    try {
      console.log(`Processing ${emails.length} emails for headline extraction...`);
      
      const allResults = [];
      let totalHeadlines = 0;

      for (const email of emails) {
        console.log(`\nProcessing: ${email.subject}`);
        
        const result = await this.extractNewsHeadlines(
          email.cleanedBody,
          email.subject,
          email.from
        );

        if (result.success) {
          console.log(`Found ${result.headlines.length} headlines`);
          totalHeadlines += result.headlines.length;
        } else {
          console.log(`Failed: ${result.error}`);
        }

        allResults.push({
          email: {
            id: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date
          },
          extraction: result
        });
      }

      console.log(`Total headlines extracted: ${totalHeadlines}`);

      return {
        success: true,
        totalEmails: emails.length,
        totalHeadlines: totalHeadlines,
        results: allResults,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error processing multiple emails:', error);
      return {
        success: false,
        error: error.message || 'Failed to process multiple emails',
        results: []
      };
    }
  }



  // Test the headline extraction with sample content
  async testExtraction(sampleContent) {
    console.log('Testing headline extraction...');
    return await this.extractNewsHeadlines(sampleContent, 'Test Email', 'test@example.com');
  }
}

module.exports = NewsHeadlineExtractor;