const axios = require('axios');

class SearXNGService {
  constructor(baseURL = 'http://localhost:8888') {
    this.baseURL = baseURL;
    this.timeout = 10000;
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  setBaseURL(url) {
    this.baseURL = url;
    console.log(`✅ SearXNG base URL updated to: ${url}`);
  }

  // Original single headline search (unchanged)
  async searchHeadline(headline, resultsCount = 4, categories = 'general') {
    try {
      console.log(`🔍 Searching: "${headline}"`);

      if (!headline || headline.trim().length === 0) {
        return {
          success: false,
          error: 'No headline provided for search',
          results: [],
          headline: headline
        };
      }

      const searchQuery = this.prepareSearchQuery(headline);
      const searchResults = await this.makeSearchRequest(searchQuery, resultsCount, categories);

      if (searchResults.success) {
        console.log(`✅ Found ${searchResults.results.length} results`);
        return {
          success: true,
          headline: headline,
          query: searchQuery,
          results: searchResults.results,
          totalFound: searchResults.results.length,
          searchedAt: new Date().toISOString()
        };
      } else {
        console.log(`❌ Search failed: ${searchResults.error}`);
        return {
          success: false,
          error: searchResults.error,
          headline: headline,
          query: searchQuery,
          results: []
        };
      }

    } catch (error) {
      console.error(`❌ Error searching for headline:`, error.message);
      return {
        success: false,
        error: error.message || 'Failed to search headline',
        headline: headline,
        results: []
      };
    }
  }

  // NEW: Parallel search with rate limiting
  async searchMultipleHeadlinesParallel(headlines, resultsPerHeadline = 4, maxParallel = 5, staggerDelay = 200) {
    try {
      console.log(`🔍 Starting parallel search for ${headlines.length} headlines`);
      console.log(`⚙️ Max parallel: ${maxParallel}, Stagger delay: ${staggerDelay}ms`);

      const startTime = Date.now();
      const allResults = [];
      let successCount = 0;
      let failureCount = 0;

      // Process headlines in chunks to respect rate limits
      for (let i = 0; i < headlines.length; i += maxParallel) {
        const chunk = headlines.slice(i, i + maxParallel);
        const chunkNumber = Math.floor(i / maxParallel) + 1;
        const totalChunks = Math.ceil(headlines.length / maxParallel);
        
        console.log(`\n📦 Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} headlines)`);
        
        // Create staggered promises for this chunk
        const chunkPromises = chunk.map((headline, index) => {
          // Stagger the start of each request
          const delay = index * staggerDelay;
          return this.delay(delay).then(() => 
            this.searchHeadline(headline, resultsPerHeadline)
          );
        });
        
        // Wait for all searches in this chunk to complete
        const chunkResults = await Promise.all(chunkPromises);
        
        // Count successes and failures
        chunkResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            failureCount++;
          }
          allResults.push(result);
        });
        
        console.log(`✅ Chunk ${chunkNumber} completed: ${chunkResults.filter(r => r.success).length}/${chunk.length} successful`);
      }

      const totalTime = Date.now() - startTime;
      console.log(`\n✅ All searches completed in ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
      console.log(`   - Successful: ${successCount}/${headlines.length}`);
      console.log(`   - Failed: ${failureCount}/${headlines.length}`);
      console.log(`   - Average time per search: ${(totalTime/headlines.length).toFixed(0)}ms`);

      return {
        success: true,
        totalHeadlines: headlines.length,
        successfulSearches: successCount,
        failedSearches: failureCount,
        results: allResults,
        totalTime: totalTime,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error in parallel headline search:', error);
      return {
        success: false,
        error: error.message || 'Failed to process headlines in parallel',
        results: []
      };
    }
  }

  // Keep the original sequential method for compatibility
  async searchMultipleHeadlines(headlines, resultsPerHeadline = 4, delayBetweenSearches = 1000) {
    // This method is kept for backward compatibility
    // but now calls the parallel version with maxParallel = 1
    return this.searchMultipleHeadlinesParallel(headlines, resultsPerHeadline, 1, delayBetweenSearches);
  }

  prepareSearchQuery(headline) {
    return headline
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async makeSearchRequest(query, resultsCount, categories, attempt = 1) {
    try {
      const searchParams = {
        q: query,
        format: 'json',
        categories: categories,
        language: 'en',
        time_range: 'week',
        safesearch: '0'
      };

      console.log(`📡 Search request (attempt ${attempt}/${this.maxRetries})`);

      const response = await axios.get(`${this.baseURL}/search`, {
        params: searchParams,
        timeout: this.timeout,
        headers: {
          'User-Agent': 'NewsHeadlineBot/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.status === 200 && response.data) {
        const results = this.parseSearchResults(response.data, resultsCount);
        return {
          success: true,
          results: results
        };
      } else {
        throw new Error(`Invalid response: Status ${response.status}`);
      }

    } catch (error) {
      console.log(`❌ Search attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < this.maxRetries) {
        console.log(`🔄 Retrying in ${this.retryDelay}ms...`);
        await this.delay(this.retryDelay);
        return this.makeSearchRequest(query, resultsCount, categories, attempt + 1);
      } else {
        return {
          success: false,
          error: `Failed after ${this.maxRetries} attempts: ${error.message}`
        };
      }
    }
  }

  parseSearchResults(data, maxResults) {
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results
      .slice(0, maxResults)
      .map((result, index) => ({
        rank: index + 1,
        title: result.title || 'No title',
        url: result.url || '',
        content: result.content || '',
        publishedDate: result.publishedDate || null,
        engine: result.engine || 'unknown',
        score: result.score || 0
      }))
      .filter(result => result.url && result.title);
  }

  async testConnection() {
    try {
      console.log(`🧪 Testing SearXNG connection to: ${this.baseURL}`);
      
      const response = await axios.get(`${this.baseURL}/search`, {
        params: {
          q: 'test',
          format: 'json'
        },
        timeout: 5000
      });

      if (response.status === 200) {
        console.log('✅ SearXNG connection successful');
        return {
          success: true,
          message: 'SearXNG is reachable and responding',
          url: this.baseURL
        };
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }

    } catch (error) {
      console.log('❌ SearXNG connection failed:', error.message);
      return {
        success: false,
        error: error.message || 'Failed to connect to SearXNG',
        url: this.baseURL
      };
    }
  }

  getSearchStatistics(searchResults) {
    if (!searchResults || !Array.isArray(searchResults)) {
      return null;
    }

    const stats = {
      totalHeadlines: searchResults.length,
      successfulSearches: searchResults.filter(r => r.success).length,
      failedSearches: searchResults.filter(r => !r.success).length,
      totalArticles: 0,
      averageArticlesPerHeadline: 0,
      engines: new Set(),
      topEngines: {}
    };

    searchResults.forEach(result => {
      if (result.success && result.results) {
        stats.totalArticles += result.results.length;
        
        result.results.forEach(article => {
          if (article.engine) {
            stats.engines.add(article.engine);
            stats.topEngines[article.engine] = (stats.topEngines[article.engine] || 0) + 1;
          }
        });
      }
    });

    stats.averageArticlesPerHeadline = stats.successfulSearches > 0 
      ? (stats.totalArticles / stats.successfulSearches).toFixed(2)
      : 0;

    stats.engines = Array.from(stats.engines);

    return stats;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SearXNGService;