const GmailService = require('./gmailService');
const NewsHeadlineExtractor = require('./newsHeadlineExtractor');
const SearXNGService = require('./searxngService');
const ArticleScraper = require('./articleScraper');
const ContentSummarizer = require('./contentSummarizer'); // NEW
const express = require('express');
require('dotenv').config();

const app = express();
const gmailService = new GmailService();
const newsAI = new NewsHeadlineExtractor();
const searxng = new SearXNGService(process.env.SEARXNG_URL || 'http://localhost:8080');
const articleScraper = new ArticleScraper();
const contentSummarizer = new ContentSummarizer(); // NEW

// Configuration
const CONFIG = {
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 3,
  MAX_PARALLEL_SEARCHES: parseInt(process.env.MAX_PARALLEL_SEARCHES) || 5,
  SEARCH_STAGGER_DELAY: parseInt(process.env.SEARCH_STAGGER_DELAY) || 200,
  RESULTS_PER_HEADLINE: 4,
  SCRAPE_URLS_PER_HEADLINE: 2,
  MAX_PARALLEL_SCRAPES: 5
};

// Process a single email (extracted for parallel processing)
async function processSingleEmail(email) {
  const startTime = Date.now();
  
  try {
    console.log(`\n📧 Processing: ${email.subject}`);
    
    // Extract headlines using AI
    const headlineResult = await newsAI.extractNewsHeadlines(
      email.cleanedBody,
      email.subject,
      email.from
    );
    
    // Initialize processed email object
    const processedEmail = {
      ...email,
      newsHeadlines: headlineResult.success ? headlineResult.headlines : [],
      headlineExtractionError: headlineResult.success ? null : headlineResult.error,
      headlineCount: headlineResult.success ? headlineResult.headlines.length : 0,
      aiMetadata: headlineResult.metadata || null,
      searchResults: [],
      scrapedArticles: [],
      headlineSummaries: [], // NEW
      searchMetadata: {
        totalSearches: 0,
        successfulSearches: 0,
        failedSearches: 0
      },
      scrapeMetadata: {
        totalScraped: 0,
        successfulScrapes: 0,
        failedScrapes: 0
      },
      summaryMetadata: { // NEW
        totalSummaries: 0,
        successfulSummaries: 0,
        failedSummaries: 0
      },
      processedAt: new Date().toISOString(),
      processingTime: 0
    };
    
    // If headlines found, search them in parallel
    if (headlineResult.success && headlineResult.headlines.length > 0) {
      console.log(`🔍 Searching ${headlineResult.headlines.length} headlines in parallel...`);
      
      const searchResults = await searxng.searchMultipleHeadlinesParallel(
        headlineResult.headlines,
        CONFIG.RESULTS_PER_HEADLINE,
        CONFIG.MAX_PARALLEL_SEARCHES,
        CONFIG.SEARCH_STAGGER_DELAY
      );
      
      if (searchResults.success) {
        processedEmail.searchResults = searchResults.results;
        processedEmail.searchMetadata = {
          totalSearches: searchResults.totalHeadlines,
          successfulSearches: searchResults.successfulSearches,
          failedSearches: searchResults.failedSearches
        };
        
        // 2. Scrape articles
        console.log(`\n🌐 Scraping articles...`);
        
        const scrapedResults = await articleScraper.scrapeHeadlineResults(
          searchResults.results,
          CONFIG.SCRAPE_URLS_PER_HEADLINE,
          CONFIG.MAX_PARALLEL_SCRAPES
        );
        
        processedEmail.scrapedArticles = scrapedResults;
        
        // Calculate scraping statistics
        const totalScraped = scrapedResults.reduce((sum, r) => sum + (r.scrapedCount || 0), 0);
        const totalAttempted = scrapedResults.reduce((sum, r) => sum + r.scrapedArticles.length, 0);
        
        processedEmail.scrapeMetadata = {
          totalScraped: totalScraped,
          successfulScrapes: totalScraped,
          failedScrapes: totalAttempted - totalScraped,
          totalAttempted: totalAttempted
        };
        
        // 3. Generate AI summaries
        console.log(`\n📝 Generating AI summaries...`);
        
        const summaryResults = await contentSummarizer.summarizeHeadlines(scrapedResults);
        
        processedEmail.headlineSummaries = summaryResults.summaries;
        processedEmail.summaryMetadata = {
          totalSummaries: summaryResults.totalHeadlines,
          successfulSummaries: summaryResults.successfulSummaries,
          failedSummaries: summaryResults.failedSummaries
        };
        
        console.log(`✅ Summaries generated: ${summaryResults.successfulSummaries}/${summaryResults.totalHeadlines}`);
      }
    }
    
    // Calculate processing time
    processedEmail.processingTime = Date.now() - startTime;
    console.log(`⏱️ Email processed in ${processedEmail.processingTime}ms`);
    
    return processedEmail;
    
  } catch (error) {
    console.error(`❌ Error processing email "${email.subject}":`, error);
    return {
      ...email,
      processingError: error.message,
      processedAt: new Date().toISOString(),
      processingTime: Date.now() - startTime
    };
  }
}

// Process emails in batches
async function processEmailsBatch(emails, batchSize = CONFIG.BATCH_SIZE) {
  const results = [];
  const totalBatches = Math.ceil(emails.length / batchSize);
  
  console.log(`📦 Processing ${emails.length} emails in ${totalBatches} batches of ${batchSize}`);
  
  for (let i = 0; i < emails.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1;
    const batch = emails.slice(i, i + batchSize);
    
    console.log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} emails)`);
    const batchStartTime = Date.now();
    
    // Process all emails in this batch in parallel
    const batchPromises = batch.map(email => processSingleEmail(email));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
    
    const batchTime = Date.now() - batchStartTime;
    console.log(`✅ Batch ${batchNumber} completed in ${batchTime}ms`);
  }
  
  return results;
}

// Main email processing function
async function processEmails() {
  const overallStartTime = Date.now();
  
  try {
    console.log('📧 Checking for new forwarded emails...');
    console.log(`⚙️ Configuration: Batch size=${CONFIG.BATCH_SIZE}, Max parallel searches=${CONFIG.MAX_PARALLEL_SEARCHES}`);
    
    // Get forwarded emails
    const emails = await gmailService.getForwardedEmails();
    
    if (emails.length === 0) {
      console.log('📭 No new forwarded emails found.');
      return { 
        processed: 0, 
        results: [], 
        headlines: [],
        totalHeadlines: 0,
        totalProcessingTime: 0
      };
    }
    
    console.log(`📬 Found ${emails.length} emails to process`);
    
    // Process emails in batches
    const processedResults = await processEmailsBatch(emails, CONFIG.BATCH_SIZE);
    
    // Aggregate results
    const allHeadlines = [];
    let totalSearches = 0;
    let successfulSearches = 0;
    let totalScrapedArticles = 0;
    let successfulScrapes = 0;
    let totalSummaries = 0;
    let successfulSummaries = 0;
    
    processedResults.forEach(result => {
      if (result.newsHeadlines && result.newsHeadlines.length > 0) {
        allHeadlines.push(...result.newsHeadlines);
      }
      totalSearches += result.searchMetadata?.totalSearches || 0;
      successfulSearches += result.searchMetadata?.successfulSearches || 0;
    });
    
    const totalTime = Date.now() - overallStartTime;
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROCESSING SUMMARY:');
    console.log(`✅ Emails processed: ${emails.length}`);
    console.log(`📰 Total headlines extracted: ${allHeadlines.length}`);
    console.log(`🔍 Total searches performed: ${totalSearches}`);
    console.log(`✅ Successful searches: ${successfulSearches}`);
    console.log(`⏱️ Total processing time: ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
    console.log(`📈 Average time per email: ${(totalTime/emails.length).toFixed(0)}ms`);
    
    return {
      processed: emails.length,
      results: processedResults,
      totalHeadlines: allHeadlines.length,
      headlines: allHeadlines,
      totalSearches: totalSearches,
      successfulSearches: successfulSearches,
      totalProcessingTime: totalTime,
      averageTimePerEmail: totalTime / emails.length,
      summary: `Processed ${emails.length} emails with ${allHeadlines.length} headlines in ${(totalTime/1000).toFixed(2)}s`
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

// API Endpoints (same as before)
app.get('/process', async (req, res) => {
  const result = await processEmails();
  res.json(result);
});

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

app.get('/headline-prompt', (req, res) => {
  res.json({ 
    prompt: newsAI.getCurrentPrompt(),
    model: 'gemini-1.5-flash',
    purpose: 'Extract news headlines from newsletter content'
  });
});

app.post('/test-headline-extraction', async (req, res) => {
  const { content, subject = 'Test Email', from = 'test@example.com' } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const result = await newsAI.extractNewsHeadlines(content, subject, from);
  res.json(result);
});

app.get('/test-searxng', async (req, res) => {
  const result = await searxng.testConnection();
  res.json(result);
});

app.post('/search-headline', async (req, res) => {
  const { headline, resultsCount = 4 } = req.body;
  
  if (!headline) {
    return res.status(400).json({ error: 'Headline is required' });
  }
  
  const result = await searxng.searchHeadline(headline, resultsCount);
  res.json(result);
});

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

app.get('/stats', (req, res) => {
  res.json({
    service: 'Newsletter News Headlines Extractor',
    model: 'gemini-1.5-flash',
    configuration: CONFIG,
    features: [
      'Parallel email processing',
      'Batch processing support',
      'Parallel headline searching',
      'Configurable rate limiting',
      'Automatic news headline extraction',
      'Filters out advertising and promotional content'
    ],
    lastStartup: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    status: '🚀 Newsletter News Headlines Extractor Running (Parallel Mode)',
    model: 'gemini-1.5-flash',
    configuration: CONFIG,
    endpoints: {
      'GET /process': 'Process forwarded emails in parallel batches',
      'POST /update-headline-prompt': 'Update news headline extraction prompt',
      'GET /headline-prompt': 'Get current headline extraction prompt',
      'POST /test-headline-extraction': 'Test headline extraction',
      'GET /test-searxng': 'Test SearXNG connection',
      'POST /search-headline': 'Search a single headline',
      'POST /update-searxng-url': 'Update SearXNG instance URL',
      'GET /stats': 'Get service statistics and configuration'
    }
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
  console.log(`📰 News Headlines Extractor Ready (Parallel Processing Mode)`);
  console.log(`⚙️ Configuration:`, CONFIG);
  console.log(`🔗 Visit http://localhost:${PORT}/process to check emails`);
});

// Optional: Run every 5 minutes
// setInterval(processEmails, 5 * 60 * 1000);

// Run once on startup
console.log('🔄 Running initial email check...');
processEmails();