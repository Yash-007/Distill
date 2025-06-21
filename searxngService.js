const axios = require('axios');

class SearXNGService {
  constructor(baseURL = 'http://localhost:8888') {
    this.baseURL = baseURL;
    this.timeout = 10000; // 10 seconds timeout
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second delay between retries
  }

  // Update SearXNG instance URL
  setBaseURL(url) {
    this.baseURL = url;
    console.log(`✅ SearXNG base URL updated to: ${url}`);
  }

  // Search for a headline and return top results
  async searchHeadline(headline, resultsCount = 4, categories = 'general') {
    try {
      console.log(`🔍 Searching SearXNG for: "${headline}"`);
      console.log(`📊 Requesting ${resultsCount} results`);

      if (!headline || headline.trim().length === 0) {
        return {
          success: false,
          error: 'No headline provided for search',
          results: [],
          headline: headline
        };
      }

      // Clean and prepare the search query
      const searchQuery = this.prepareSearchQuery(headline);
      console.log(`🔧 Prepared query: "${searchQuery}"`);

      // Make the search request with retry logic
      const searchResults = await this.makeSearchRequest(searchQuery, resultsCount, categories);

      if (searchResults.success) {
        console.log(`✅ Found ${searchResults.results.length} results for: "${headline}"`);
        
        // Log sample results
        if (searchResults.results.length > 0) {
          console.log('📄 Sample results:');
          searchResults.results.slice(0, 2).forEach((result, index) => {
            console.log(`  ${index + 1}. ${result.title}`);
            console.log(`     ${result.url}`);
          });
        }

        return {
          success: true,
          headline: headline,
          query: searchQuery,
          results: searchResults.results,
          totalFound: searchResults.results.length,
          searchedAt: new Date().toISOString()
        };
      } else {
        console.log(`❌ Search failed for: "${headline}" - ${searchResults.error}`);
        return {
          success: false,
          error: searchResults.error,
          headline: headline,
          query: searchQuery,
          results: []
        };
      }

    } catch (error) {
      console.error(`❌ Error searching for headline "${headline}":`, error.message);
      return {
        success: false,
        error: error.message || 'Failed to search headline',
        headline: headline,
        results: []
      };
    }
  }

  // Prepare search query from headline
  prepareSearchQuery(headline) {
    // Clean the headline for better search results
    return headline
      .replace(/[^\w\s-]/g, ' ') // Remove special characters except hyphens
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim()
  }

  // Make the actual search request with retry logic
  async makeSearchRequest(query, resultsCount, categories, attempt = 1) {
    try {
      const searchParams = {
        q: query,
        format: 'json',
        categories: categories,
        language: 'en',
        time_range: 'week', // Search for recent articles
        safesearch: '0'
      };

      console.log(`📡 Making SearXNG request (attempt ${attempt}/${this.maxRetries})`);

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
      
      // Retry logic
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

  // Parse and format search results
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
      .filter(result => result.url && result.title); // Filter out invalid results
  }

  // Search multiple headlines in batch
  async searchMultipleHeadlines(headlines, resultsPerHeadline = 4, delayBetweenSearches = 1000) {
    try {
      console.log(`🔍 Starting batch search for ${headlines.length} headlines`);
      console.log(`⏱️  Delay between searches: ${delayBetweenSearches}ms`);

      const allResults = [];
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < headlines.length; i++) {
        const headline = headlines[i];
        console.log(`\n📰 Processing headline ${i + 1}/${headlines.length}: "${headline}"`);

        const searchResult = await this.searchHeadline(headline, resultsPerHeadline);
        
        if (searchResult.success) {
          successCount++;
        } else {
          failureCount++;
        }

        allResults.push(searchResult);

        // Add delay between searches to avoid overwhelming the server
        if (i < headlines.length - 1) {
          console.log(`⏳ Waiting ${delayBetweenSearches}ms before next search...`);
          await this.delay(delayBetweenSearches);
        }
      }

      console.log(`\n✅ Batch search completed:`);
      console.log(`   - Successful searches: ${successCount}`);
      console.log(`   - Failed searches: ${failureCount}`);
      console.log(`   - Total headlines processed: ${headlines.length}`);

      return {
        success: true,
        totalHeadlines: headlines.length,
        successfulSearches: successCount,
        failedSearches: failureCount,
        results: allResults,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error in batch headline search:', error);
      return {
        success: false,
        error: error.message || 'Failed to process multiple headlines',
        results: []
      };
    }
  }

  // Test SearXNG connection
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

  // Get search statistics for a set of results
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

    // Calculate detailed statistics
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

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SearXNGService;