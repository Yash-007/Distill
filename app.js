const GmailService = require('./gmailService');
const NewsHeadlineExtractor = require('./newsHeadlineExtractor'); // Import the AI service
const SearXNGService = require('./searxngService'); // Import SearXNG service
const express = require('express');
require('dotenv').config();

const app = express();
const gmailService = new GmailService();
const newsAI = new NewsHeadlineExtractor(); // Initialize AI service
const searxng = new SearXNGService(process.env.SEARXNG_URL || 'http://localhost:8080'); // Initialize SearXNG service

// Middleware
app.use(express.json());



// API endpoint to test SearXNG connection
app.get('/test-searxng', async (req, res) => {
  const result = await searxng.testConnection();
  res.json(result);
});

// API endpoint to search a single headline
app.post('/search-headline', async (req, res) => {
  const { headline, resultsCount = 4 } = req.body;
  
  if (!headline) {
    return res.status(400).json({ error: 'Headline is required' });
  }
  
  const result = await searxng.searchHeadline(headline, resultsCount);
  res.json(result);
});

// API endpoint to update SearXNG URL
app.post('/update-searxng-url', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'SearXNG URL is required' });
  }
  
  searxng.setBaseURL(url);
  const testResult = await searxng.testConnection();
  
  res.json({
    success: testResult.success,
    message: testResult.success ? 'SearXNG URL updated and tested successfully' : 'SearXNG URL updated but connection test failed',
    url: url,
    connectionTest: testResult
  });
});


// Process forwarded emails with AI news headline extraction
async function processEmails() {
  try {
    console.log('📧 Checking for new forwarded emails...');
    
    // Get forwarded emails
    const emails = await gmailService.getForwardedEmails();
    
    if (emails.length === 0) {
      console.log('📭 No new forwarded emails found.');
      return { 
        processed: 0, 
        results: [], 
        headlines: [],
        totalHeadlines: 0 
      };
    }
    
    console.log(`📬 Found ${emails.length} emails to process`);
    const processedResults = [];
    const allHeadlines = [];
    const emailSources = [];
    
    // Process each email for news headlines
    for (const email of emails) {
      console.log('\n' + '='.repeat(60));
      console.log('📧 Processing Email:');
      console.log('From:', email.from);
      console.log('Subject:', email.subject);
      console.log('Date:', email.date);
      console.log('Links found:', email.links.length);
      console.log('Content length:', email.cleanedBody.length);
      
      // Log first few links
      if (email.links.length > 0) {
        console.log('🔗 Sample links:');
        email.links.slice(0, 3).forEach(link => {
          console.log(' -', link);
        });
      }

            // Initialize processed email object early
            const processedEmail = {
              ...email,
              newsHeadlines: [],
              headlineExtractionError: null,
              headlineCount: 0,
              aiMetadata: null,
              searchResults: [],
              searchMetadata: {
                totalSearches: 0,
                successfulSearches: 0,
                failedSearches: 0
              },
              processedAt: new Date().toISOString()
            };
            
      
      // Extract news headlines using AI
      console.log('\n🤖 Starting AI headline extraction...');
      const headlineResult = await newsAI.extractNewsHeadlines(
        email.cleanedBody,
        email.subject,
        email.from
      );
      
      if (headlineResult.success && headlineResult.headlines.length > 0) {
        console.log(`📰 News Headlines Found (${headlineResult.headlines.length}):`);
        headlineResult.headlines.forEach((headline, index) => {
          console.log(`  ${index + 1}. ${headline}`);
        });
        

        // Update processed email with headline data
        processedEmail.newsHeadlines = headlineResult.headlines;
        processedEmail.headlineCount = headlineResult.headlines.length;
        processedEmail.aiMetadata = headlineResult.metadata || null;

        // Add to overall collection
        allHeadlines.push(...headlineResult.headlines);
        emailSources.push(email.subject.replace('Fwd: ', ''));

        // Search each headline using SearXNG
        console.log('\n🌐 Starting SearXNG searches for headlines...');
        const searchResults = await searxng.searchMultipleHeadlines(
          headlineResult.headlines, 
          4, // 4 results per headline
          2000 // 2 second delay between searches
        );

        if (searchResults.success) {
          console.log(`✅ SearXNG search completed for ${searchResults.successfulSearches}/${searchResults.totalHeadlines} headlines`);
          
          // Log sample search results
          searchResults.results.forEach((result, index) => {
            if (result.success && result.results.length > 0) {
              console.log(`\n📄 Articles for: "${result.headline}"`);
              result.results.forEach((article, articleIndex) => {
                console.log(`    ${articleIndex + 1}. ${article.title}`);
                console.log(`       ${article.url}`);
              });
            }
          });
        } else {
          console.log('❌ SearXNG search failed:', searchResults.error);
        }

        // Store search results with the processed email
        processedEmail.searchResults = searchResults.success ? searchResults.results : [];
        processedEmail.searchMetadata = {
          totalSearches: searchResults.totalHeadlines || 0,
          successfulSearches: searchResults.successfulSearches || 0,
          failedSearches: searchResults.failedSearches || 0
        };
      } else {
        console.log('📭 No news headlines found in this email');
        if (headlineResult.error) {
          console.log('❌ AI Error:', headlineResult.error);
        }
        
        // No headlines to search
        processedEmail.searchResults = [];
        processedEmail.searchMetadata = {
          totalSearches: 0,
          successfulSearches: 0,
          failedSearches: 0
        };
      }
      
      processedResults.push(processedEmail);
      
      // Send confirmation reply with headlines (currently commented out)
      try {
        const replySubject = `Re: ${email.subject}`;
        let replyContent;
        
        if (headlineResult.success && headlineResult.headlines.length > 0) {
          replyContent = `
✅ Newsletter processed successfully!

📰 News Headlines Extracted (${headlineResult.headlines.length}):
${headlineResult.headlines.map((headline, index) => `${index + 1}. ${headline}`).join('\n')}

🔍 Search Results: Found articles for ${processedEmail.searchMetadata.successfulSearches}/${processedEmail.searchMetadata.totalSearches} headlines

Your headlines and related articles have been processed and stored.
Thank you for using our newsletter processing service!
          `.trim();
        } else {
          replyContent = `
✅ Newsletter processed!

📭 No news headlines were detected in this newsletter. This might be because:
- The content is primarily promotional/advertising
- It doesn't contain traditional news content  
- The format wasn't recognized as news

Your newsletter has been reviewed and archived.
Thank you for using our service!
          `.trim();
        }
        
        // Uncomment the line below to actually send replies
        // await gmailService.sendReply(email.senderEmail, replySubject, email.id);
        
        console.log('✅ Reply prepared for:', email.senderEmail);
        
      } catch (replyError) {
        console.error('❌ Error preparing reply:', replyError);
      }
      
      console.log('✅ Email processing completed');
    }
    
    // Summary of all headlines found
    if (allHeadlines.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log(`📊 SUMMARY: Found ${allHeadlines.length} total headlines from ${emails.length} emails`);
      console.log('📰 All extracted headlines:');
      allHeadlines.forEach((headline, index) => {
        console.log(`  ${index + 1}. ${headline}`);
      });
    } else {
      console.log('\n📭 No news headlines found across all emails');
    }
  
    
    console.log(processedResults, 'processedResults');
    
    return {
      processed: emails.length,
      results: processedResults,
      totalHeadlines: allHeadlines.length,
      headlines: allHeadlines,
      summary: `Successfully processed ${emails.length} emails and extracted ${allHeadlines.length} news headlines`
    };
    
  } catch (error) {
    console.error('❌ Error processing emails:', error);
    return {
      processed: 0,
      results: [],
      headlines: [],
      totalHeadlines: 0,
      error: error.message
    };
  }
}

// API endpoint to manually trigger processing
app.get('/process', async (req, res) => {
  const result = await processEmails();
  res.json(result);
});

// API endpoint to update news headline extraction prompt
app.post('/update-headline-prompt', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  const result = newsAI.updatePrompt(prompt);
  res.json({ 
    success: true, 
    message: 'News headline extraction prompt updated successfully',
    prompt: prompt
  });
});

// API endpoint to get current headline extraction prompt
app.get('/headline-prompt', (req, res) => {
  res.json({ 
    prompt: newsAI.getCurrentPrompt(),
    model: 'gemini-1.5-flash',
    purpose: 'Extract news headlines from newsletter content'
  });
});

// API endpoint to test headline extraction with custom content
app.post('/test-headline-extraction', async (req, res) => {
  const { content, subject = 'Test Email', from = 'test@example.com' } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const result = await newsAI.extractNewsHeadlines(content, subject, from);
  res.json(result);
});

// API endpoint to get processing statistics
app.get('/stats', (req, res) => {
  res.json({
    service: 'Newsletter News Headlines Extractor',
    model: 'gemini-1.5-flash',
    features: [
      'Automatic news headline extraction',
      'Filters out advertising and promotional content',
      'Email processing automation',
      'Configurable AI prompts'
    ],
    lastStartup: new Date().toISOString()
  });
});

// Health check and API documentation
app.get('/', (req, res) => {
  res.json({ 
    status: '🚀 Newsletter News Headlines Extractor Running',
    model: 'gemini-1.5-flash',
    purpose: 'Extract news headlines from forwarded newsletters',
    endpoints: {
      'GET /process': 'Process forwarded emails and extract news headlines with search',
      'POST /update-headline-prompt': 'Update news headline extraction prompt',
      'GET /headline-prompt': 'Get current headline extraction prompt',
      'POST /test-headline-extraction': 'Test headline extraction with custom content',
      'GET /test-searxng': 'Test SearXNG connection',
      'POST /search-headline': 'Search a single headline using SearXNG',
      'POST /update-searxng-url': 'Update SearXNG instance URL',
      'GET /stats': 'Get service statistics and information'
    },
    features: [
      '📧 Automatic Gmail forwarded email processing',
      '🤖 AI-powered news headline extraction',
      '🚫 Filters out advertising and promotional content',  
      '🔍 SearXNG integration for finding related articles',
      '📰 Lists all extracted headlines with search results',
      '⚙️ Configurable AI prompts and SearXNG settings',
      '📨 Email reply confirmation (optional)'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📰 News Headlines Extractor Ready`);
  console.log(`🔗 Visit http://localhost:${PORT}/process to check emails`);
  console.log(`🤖 Using Gemini 1.5 Flash for news headline extraction`);
  console.log(`🔍 Using SearXNG at: ${process.env.SEARXNG_URL || 'http://localhost:8080'}`);
  console.log(`⚙️  Visit http://localhost:${PORT}/headline-prompt to view current prompt`);
  console.log(`🧪 Visit http://localhost:${PORT}/test-headline-extraction to test extraction`);
  console.log(`🌐 Visit http://localhost:${PORT}/test-searxng to test SearXNG connection`);
  console.log(`📊 Visit http://localhost:${PORT}/stats for service information`);
});

// Optional: Run every 5 minutes (uncomment to enable)
// setInterval(processEmails, 5 * 60 * 1000);

// Run once on startup
console.log('🔄 Running initial email check...');
processEmails();


// async function testSearXNG() {
//   const result = await searxng.searchHeadline("Microsoft to axe thousands of its sales staff", 4);
//   console.log(result);
// }

// testSearXNG();