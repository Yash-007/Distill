const axios = require('axios');
const cheerio = require('cheerio');
const pLimit = require('p-limit');

class ArticleScraper {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000;
    this.maxRetries = options.maxRetries || 2;
    this.delayRange = options.delayRange || [500, 1500];
    
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    ];
    
    this.axiosConfig = {
      timeout: this.timeout,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
      })
    };
  }
  
  getRandomDelay() {
    const [min, max] = this.delayRange;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  getHeaders() {
    return {
      'User-Agent': this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    };
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  extractContent($) {
    // Remove scripts and styles
    $('script, style, noscript').remove();
    
    let contentElement = null;
    
    // Try common article selectors
    const selectors = [
      'article', 'main', '[role="main"]',
      '.article-content', '.article-body', '.post-content',
      '.entry-content', '.content', '#content', '.story-body',
      '[itemprop="articleBody"]', '.article__body'
    ];
    
    for (const selector of selectors) {
      contentElement = $(selector).first();
      if (contentElement.length && contentElement.text().trim().length > 50) break;
    }
    
    // Extract text
    let text = '';
    if (contentElement && contentElement.length) {
      const paragraphs = contentElement.find('p');
      if (paragraphs.length) {
        text = paragraphs.map((i, p) => $(p).text().trim())
          .get()
          .filter(t => t.length > 0)
          .join('\n\n');
      } else {
        text = contentElement.text().trim();
      }
    } else {
      // Fallback: get all paragraphs
      text = $('p').map((i, p) => $(p).text().trim())
        .get()
        .filter(t => t.length > 30)
        .join('\n\n');
    }
    
    return this.cleanText(text);
  }
  
  cleanText(text) {
    if (!text) return '';
    
    // Remove extra whitespace
    text = text.split(/\s+/).join(' ');
    
    // Remove common artifacts
    const artifacts = [
      'Advertisement', 'ADVERTISEMENT', 'Cookie Notice',
      'Subscribe', 'Sign up', 'Newsletter', 'Share this'
    ];
    
    artifacts.forEach(artifact => {
      text = text.replace(new RegExp(artifact, 'gi'), ' ');
    });
    
    return text.split(/\s+/).join(' ').trim();
  }
  
  extractMetadata($) {
    return {
      title: $('title').text().trim() || 
             $('meta[property="og:title"]').attr('content') || 
             $('h1').first().text().trim() || null,
      description: $('meta[name="description"]').attr('content') || 
                  $('meta[property="og:description"]').attr('content') || null,
      author: $('meta[name="author"]').attr('content') || 
              $('meta[property="article:author"]').attr('content') || null
    };
  }
  
  async scrapeUrl(url, attempt = 1) {
    try {
      // Add delay to avoid rate limiting
      await this.sleep(this.getRandomDelay());
      
      console.log(`🔧 Scraping ${url} (attempt ${attempt})`);
      
      const response = await axios.get(url, {
        ...this.axiosConfig,
        headers: this.getHeaders()
      });
      
      if (response.status >= 400) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const $ = cheerio.load(response.data);
      
      const content = this.extractContent($);
      const metadata = this.extractMetadata($);
      
      // Get first 150 words for summary if content is long
      const words = content.split(/\s+/);
      const contentPreview = words.slice(0, 150).join(' ') + (words.length > 150 ? '...' : '');
      
      return {
        success: true,
        url: url,
        title: metadata.title,
        author: metadata.author,
        content: content,
        contentPreview: contentPreview,
        wordCount: words.length,
        scrapedAt: new Date().toISOString()
      };
      
    } catch (error) {
      if (attempt < this.maxRetries) {
        console.log(`⚠ Retry ${attempt}/${this.maxRetries} for ${url}`);
        await this.sleep(this.getRandomDelay() * 2);
        return this.scrapeUrl(url, attempt + 1);
      }
      
      console.log(`❌ Failed to scrape ${url}: ${error.message}`);
      return {
        success: false,
        url: url,
        error: error.message || 'Scraping failed',
        scrapedAt: new Date().toISOString()
      };
    }
  }
  
  // Scrape search results for multiple headlines
  async scrapeHeadlineResults(headlineSearchResults, urlsPerHeadline = 2, maxParallel = 5) {
    console.log(`\n📰 Starting article scraping for ${headlineSearchResults.length} headlines`);
    console.log(`⚙ Scraping first ${urlsPerHeadline} URLs per headline`);
    
    const results = [];
    
    // Process headlines in batches of 5

    const batchSize = 5;
    for (let i = 0; i < headlineSearchResults.length; i += batchSize) {
      const batch = headlineSearchResults.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(headlineSearchResults.length / batchSize);
      
      console.log(`\n📦 Scraping batch ${batchNumber}/${totalBatches} (${batch.length} headlines)`);
      
      // Create scraping tasks for this batch
      const batchTasks = [];
      
      for (const headlineResult of batch) {
        // each headline 
        //     return {
        //   success: true,
        //   headline: headline,
        //   query: searchQuery,
        //   results: searchResults.results,
        //   totalFound: searchResults.results.length,
        //   searchedAt: new Date().toISOString()
        // };
        if (!headlineResult.success || !headlineResult.results || headlineResult.results.length === 0) {
          // No search results for this headline
          results.push({
            headline: headlineResult.headline,
            searchSuccess: false,
            scrapedArticles: []
          });
          continue;
        }
        
        // Take only the first N URLs
        const urlsToScrape = headlineResult.results
          .slice(0, urlsPerHeadline)
          .map(r => r.url);
        
        // Create scraping promises for this headline
        const headlineScrapeTasks = urlsToScrape.map(url => this.scrapeUrl(url));
        
        batchTasks.push({
          headline: headlineResult.headline,
          searchResults: headlineResult.results,
          scrapeTasks: headlineScrapeTasks
        });
      }
      
      // Process all scraping tasks in this batch with concurrency limit
      const limit = pLimit(maxParallel);
      
      for (const task of batchTasks) {
        const scrapedArticles = await Promise.all(
          task.scrapeTasks.map(scrapeTask => limit(() => scrapeTask))
        );

        // each scraped article 
      //   return {
      //   success: true,
      //   url: url,
      //   title: metadata.title,
      //   author: metadata.author,
      //   content: content,
      //   contentPreview: contentPreview,
      //   wordCount: words.length,
      //   scrapedAt: new Date().toISOString()
      // };
        results.push({
          headline: task.headline,
          searchSuccess: true, 
          totalSearchResults: task.searchResults.length,
          scrapedCount: scrapedArticles.filter(a => a.success).length,
          scrapedArticles: scrapedArticles
        });
        
        console.log(`✅ Scraped ${scrapedArticles.filter(a => a.success).length}/${scrapedArticles.length} articles for: "${task.headline}"`);
      }
      
      console.log(`✅ Batch ${batchNumber} completed`);
    }
    
    // Summary
    const totalScraped = results.reduce((sum, r) => sum + (r.scrapedCount || 0), 0);
    const totalAttempted = results.reduce((sum, r) => sum + r.scrapedArticles.length, 0);
    
    console.log(`\n📊 Scraping Summary:`);
    console.log(`   - Headlines processed: ${results.length}`);
    console.log(`   - Articles scraped successfully: ${totalScraped}/${totalAttempted}`);
    
    return results;
  }
}

module.exports = ArticleScraper;