const GmailService = require('./gmailService');
const NewsHeadlineExtractor = require('./newsHeadlineExtractor');
const SearXNGService = require('./searxngService');
const ArticleScraper = require('./articleScraper');
const ContentSummarizer = require('./contentSummarizer'); // NEW
const express = require('express');
const fs = require('fs');
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

// Process a single email (updated with summarization)
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
    
    // If headlines found, search, scrape, and summarize
    if (headlineResult.success && headlineResult.headlines.length > 0) {
      // 1. Search headlines
      console.log(`🔍 Searching ${headlineResult.headlines.length} headlines...`);
      
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

// Test function for complete pipeline
async function testCompletePipeline() {
  console.log('🧪 Testing Complete Pipeline...\n');
  
  // Test headlines
  const testHeadlines = [
    "Microsoft announces major layoffs in gaming division",
    "Apple unveils new Vision Pro features at WWDC"
  ];
  
  // 1. Search
  console.log('1️⃣ Searching headlines...');
  const searchResults = await searxng.searchMultipleHeadlinesParallel(
    testHeadlines,
    CONFIG.RESULTS_PER_HEADLINE,
    CONFIG.MAX_PARALLEL_SEARCHES,
    CONFIG.SEARCH_STAGGER_DELAY
  );
  
  if (searchResults.success) {
    // 2. Scrape
    console.log('\n2️⃣ Scraping articles...');
    const scrapedResults = await articleScraper.scrapeHeadlineResults(
      searchResults.results,
      CONFIG.SCRAPE_URLS_PER_HEADLINE,
      CONFIG.MAX_PARALLEL_SCRAPES
    );
    
    // 3. Summarize
    console.log('\n3️⃣ Generating summaries...');
    const summaryResults = await contentSummarizer.summarizeHeadlines(scrapedResults);
    fs.writeFileSync('test_summaries_result.json', JSON.stringify(summaryResults, null, 2), 'utf-8');

    // 4. Display results
    console.log('\n📊 Complete Pipeline Results:');
    console.log('='.repeat(70));
    
    summaryResults.summaries.forEach((summary, index) => {
      console.log(`\n📰 Headline: "${summary.headline}"`);
      
      if (summary.success) {
        console.log(`✅ Summary (${summary.wordCount} words):`);
        console.log(`   ${summary.summary}`);
        console.log(`\n📌 Source: ${summary.sourceArticle.title || 'No title'}`);
        console.log(`   URL: ${summary.sourceArticle.url}`);
        console.log(`   (Article ${summary.sourceArticle.articleIndex} of ${summary.sourceArticle.totalArticlesChecked} checked)`);
      } else {
        console.log(`❌ No summary generated`);
        console.log(`   Reason: ${summary.reason}`);
      }
      
      console.log('-'.repeat(70));
    });
  }
}

// Helper function to display complete results
function logCompleteResults(email) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPLETE PROCESSING RESULTS');
  console.log('='.repeat(80));
  
  console.log(`\n📧 Email: ${email.subject}`);
  console.log(`   Headlines found: ${email.headlineCount}`);
  console.log(`   Articles scraped: ${email.scrapeMetadata.successfulScrapes}`);
  console.log(`   Summaries generated: ${email.summaryMetadata.successfulSummaries}`);
  
  if (email.headlineSummaries && email.headlineSummaries.length > 0) {
    console.log('\n📝 Generated Summaries:');
    
    email.headlineSummaries.forEach((summary, idx) => {
      console.log(`\n${idx + 1}. "${summary.headline}"`);
      
      if (summary.success) {
        console.log(`   ✅ Summary: ${summary.summary}`);
        console.log(`   📌 Source: ${summary.sourceArticle.title || 'Article'} (checked ${summary.sourceArticle.totalArticlesChecked} articles)`);
      } else {
        console.log(`   ❌ No relevant content found`);
      }
    });
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

// Update process emails to include summary stats
async function processEmails() {
  const overallStartTime = Date.now();
  
  try {
    console.log('📧 Checking for new forwarded emails...');
    
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
    
    const processedResults = await processEmailsBatch(emails, CONFIG.BATCH_SIZE);
    
    // Log complete results for each email
    processedResults.forEach(email => logCompleteResults(email));
    
    // Aggregate results
    const allHeadlines = [];
    const allSummaries = [];
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
      
      if (result.headlineSummaries && result.headlineSummaries.length > 0) {
        allSummaries.push(...result.headlineSummaries.filter(s => s.success));
      }
      
      totalSearches += result.searchMetadata?.totalSearches || 0;
      successfulSearches += result.searchMetadata?.successfulSearches || 0;
      totalScrapedArticles += result.scrapeMetadata?.totalAttempted || 0;
      successfulScrapes += result.scrapeMetadata?.successfulScrapes || 0;
      totalSummaries += result.summaryMetadata?.totalSummaries || 0;
      successfulSummaries += result.summaryMetadata?.successfulSummaries || 0;
    });
    
    const totalTime = Date.now() - overallStartTime;
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL PROCESSING SUMMARY:');
    console.log(`✅ Emails processed: ${emails.length}`);
    console.log(`📰 Headlines extracted: ${allHeadlines.length}`);
    console.log(`🔍 Searches performed: ${successfulSearches}/${totalSearches}`);
    console.log(`🌐 Articles scraped: ${successfulScrapes}/${totalScrapedArticles}`);
    console.log(`📝 Summaries generated: ${successfulSummaries}/${totalSummaries}`);
    console.log(`⏱️ Total time: ${(totalTime/1000).toFixed(2)}s`);
    console.log('='.repeat(60));
    
    return {
      processed: emails.length,
      results: processedResults,
      totalHeadlines: allHeadlines.length,
      headlines: allHeadlines,
      summaries: allSummaries,
      totalSearches: totalSearches,
      successfulSearches: successfulSearches,
      totalScrapedArticles: totalScrapedArticles,
      successfulScrapes: successfulScrapes,
      totalSummaries: totalSummaries,
      successfulSummaries: successfulSummaries,
      totalProcessingTime: totalTime,
      averageTimePerEmail: totalTime / emails.length
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

// Test endpoint
app.get('/test-complete-pipeline', async (req, res) => {
  await testCompletePipeline();
  res.json({ message: 'Pipeline test completed. Check console for results.' });
});

// Other endpoints remain the same...

// Process emails in batches remains the same...
async function processEmailsBatch(emails, batchSize = CONFIG.BATCH_SIZE) {
  const results = [];
  const totalBatches = Math.ceil(emails.length / batchSize);
  
  for (let i = 0; i < emails.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1;
    const batch = emails.slice(i, i + batchSize);
    
    console.log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} emails)`);
    const batchStartTime = Date.now();
    
    const batchPromises = batch.map(email => processSingleEmail(email));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
    
    const batchTime = Date.now() - batchStartTime;
    console.log(`✅ Batch ${batchNumber} completed in ${batchTime}ms`);
  }
  
  return results;
}

async function main() {
  // await testCompletePipeline();
  const results = await processEmails();
  fs.writeFileSync('final_result.json', JSON.stringify(results, null, 2), 'utf-8');
  // console.log(results);
}

main();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📰 Newsletter Processor with AI Summarization Ready`);
  console.log(`🔗 Test complete pipeline: http://localhost:${PORT}/test-complete-pipeline`);
});