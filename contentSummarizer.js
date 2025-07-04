const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

class ContentSummarizer {
  constructor() {
    this.initializeVertexAI();
    
    // Configuration for delays
    this.API_CALL_DELAY = 10000; // 15 seconds between API calls
    this.lastApiCallTime = 0;
  }

  async initializeVertexAI() {
    try {
      // Get project ID and location
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
      const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
      
      if (!projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID environment variable is required');
      }
      
      console.log(`🔧 Initializing Vertex AI...`);
      console.log(`📁 Project: ${projectId}`);
      console.log(`📍 Location: ${location}`);
    
      
      // Initialize Vertex AI 
      this.vertexAI = new VertexAI({
        project: projectId,
        location: location,
      });
      
      // Initialize the model
      this.model = this.vertexAI.preview.getGenerativeModel({
        model: 'gemini-2.0-flash-lite-001',
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          topK: 40,
        },
      });

      console.log(`✅ Vertex AI initialized successfully`);      
    } catch (error) {
      console.error('❌ Failed to initialize Vertex AI:', error.message);
      throw error;
    }
  }

  // Ensure minimum delay between API calls
  async enforceApiDelay() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    
    if (timeSinceLastCall < this.API_CALL_DELAY) {
      const waitTime = this.API_CALL_DELAY - timeSinceLastCall;
      console.log(`⏳ Waiting ${(waitTime/1000).toFixed(1)}s before next API call...`);
      await this.sleep(waitTime);
    }
    
    this.lastApiCallTime = Date.now();
  }

  // Check relevance and summarize content
  async analyzeAndSummarize(headline, articleContent, articleTitle = '') {
    try {
      // Enforce delay before API call
      await this.enforceApiDelay();
      
      const prompt = `
You are a news content analyzer. Your task is to:
1. Check if the article content is relevant to the given headline
2. If relevant, create a 100-word summary
3. If not relevant, respond with "NOT_RELEVANT"

Headline: "${headline}"
Article Title: "${articleTitle}"

Article Content:
${articleContent.substring(0, 3000)} // Limit content length for API

Instructions:
- First determine if the article content actually relates to the headline topic
- If the content is about a completely different topic, respond with "NOT_RELEVANT"
- If relevant, write EXACTLY a 100-word summary that captures the key points
- Focus on facts and main information
- Do not include phrases like "This article discusses" or "The content talks about"
- Start directly with the information

Response format:
If relevant: [100-word summary]
If not relevant: NOT_RELEVANT
`;

      console.log(`🤖 Checking relevance for headline: "${headline}"`);
      console.log(`📡 Making Vertex AI call (gemini-2.0-flash-lite-001)...`);
      
      // Generate content using Vertex AI
      const request = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      };
      
      const result = await this.model.generateContent(request);
      const response = result.response;
      
      // Extract text from response
      let responseText = '';
      if (response.candidates && response.candidates[0]) {
        responseText = response.candidates[0].content.parts[0].text.trim();
      }
      
      if (!responseText || responseText === 'NOT_RELEVANT' || responseText.includes('NOT_RELEVANT')) {
        return {
          relevant: false,
          summary: null
        };
      }
      
      // Count words in summary
      const wordCount = responseText.split(/\s+/).filter(word => word.length > 0).length;
      console.log(`✅ Content relevant, summary generated (${wordCount} words)`);
      
      return {
        relevant: true,
        summary: responseText,
        wordCount: wordCount
      };
      
    } catch (error) {
      console.error('Error in content analysis:', error.message);
      
      // Log more details for Vertex AI errors
      if (error.details) {
        console.error('Error details:', error.details);
      }
      
      return {
        relevant: false,
        summary: null,
        error: error.message
      };
    }
  }

  // Process scraped articles for a headline
  async findAndSummarizeRelevantContent(headline, scrapedArticles) {
    console.log(`\n📄 Processing ${scrapedArticles.length} articles for: "${headline}"`);
    
    for (let i = 0; i < scrapedArticles.length; i++) {
      const article = scrapedArticles[i];
      
      if (!article.success || !article.content || article.content.length < 100) {
        console.log(`   ⏭️ Article ${i + 1}: Skipped (no content)`);
        continue;
      }
      
      console.log(`   🔍 Checking article ${i + 1}: "${article.title || 'No title'}"`);
      
      const analysis = await this.analyzeAndSummarize(
        headline,
        article.content,
        article.title
      );
      
      if (analysis.relevant && analysis.summary) {
        console.log(`   ✅ Found relevant content! Summary generated.`);
        return {
          success: true,
          summary: analysis.summary,
          wordCount: analysis.wordCount,
          sourceArticle: {
            url: article.url,
            title: article.title,
            articleIndex: i + 1,
            totalArticlesChecked: i + 1
          },
          headline: headline
        };
      } else {
        console.log(`   ❌ Not relevant to headline`);
      }
    }
    
    console.log(`   ⚠️ No relevant content found among ${scrapedArticles.length} articles`);
    return {
      success: false,
      summary: null,
      headline: headline,
      reason: 'No relevant content found in scraped articles',
      totalArticlesChecked: scrapedArticles.length
    };
  }

  // Process multiple headlines with their scraped articles
  async summarizeHeadlines(scrapedResults) {
    console.log(`\n🤖 Starting AI summarization for ${scrapedResults.length} headlines...`);
    console.log(`🚀 Using Vertex AI with model: gemini-2.0-flash-lite-001`);
    console.log(`⏱️ Note: Using ${this.API_CALL_DELAY/1000}s delay between API calls`);
    
    // Estimate total time
    const totalApiCalls = scrapedResults.reduce((sum, h) => {
      return sum + (h.scrapedArticles ? h.scrapedArticles.length : 0);
    }, 0);
    const estimatedTime = (totalApiCalls * this.API_CALL_DELAY) / 1000 / 60;
    console.log(`⏰ Estimated time: ~${estimatedTime.toFixed(1)} minutes for up to ${totalApiCalls} API calls`);
    
    const summaries = [];
    let successCount = 0;
    const startTime = Date.now();
    
    for (const headlineData of scrapedResults) {
      if (!headlineData.scrapedArticles || headlineData.scrapedArticles.length === 0) {
        summaries.push({
          headline: headlineData.headline,
          success: false,
          summary: null,
          reason: 'No articles to analyze'
        });
        continue;
      }
      
      const summaryResult = await this.findAndSummarizeRelevantContent(
        headlineData.headline,
        headlineData.scrapedArticles
      );
      
      if (summaryResult.success) {
        successCount++;
      }
      
      summaries.push(summaryResult);
      
      // Progress update
      const processed = summaries.length;
      const remaining = scrapedResults.length - processed;
      if (remaining > 0) {
        console.log(`📊 Progress: ${processed}/${scrapedResults.length} headlines processed, ${remaining} remaining`);
      }
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n✅ Summarization complete: ${successCount}/${scrapedResults.length} headlines summarized`);
    console.log(`⏱️ Total time: ${totalTime.toFixed(1)}s (${(totalTime/60).toFixed(1)} minutes)`);
    
    return {
      success: true,
      totalHeadlines: scrapedResults.length,
      successfulSummaries: successCount,
      failedSummaries: scrapedResults.length - successCount,
      summaries: summaries,
      processingTime: totalTime
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ContentSummarizer;