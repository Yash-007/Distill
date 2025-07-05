const { PrismaClient } = require('@prisma/client');

class DatabaseService {
  constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  // User operations
  async findOrCreateUser(email) {
    try {
      let user = await this.prisma.user.findUnique({
        where: { id: email }
      });

      if (!user) {
        console.log(`📝 Creating new user: ${email}`);
        user = await this.prisma.user.create({
          data: { id: email }
        });
      }

      return user;
    } catch (error) {
      console.error('Error in findOrCreateUser:', error);
      throw error;
    }
  }

  // Email operations
  async saveEmail(emailData, userId) {
    try {
      // Check if email already processed
      const existing = await this.prisma.email.findUnique({
        where: { gmailId: emailData.id }
      });

      if (existing) {
        console.log(`📧 Email already processed: ${emailData.subject}`);
        return existing;
      }

      // Save new email
      const email = await this.prisma.email.create({
        data: {
          userId: userId,
          gmailId: emailData.id,
          subject: emailData.subject,
          fromEmail: emailData.senderEmail,
          fromName: emailData.from,
          content: emailData.body || '',
          cleanedBody: emailData.cleanedBody || '',
          linkCount: emailData.links?.length || 0,
          wordCount: emailData.cleanedBody?.split(/\s+/).length || 0,
          receivedAt: new Date(emailData.date)
        }
      });

      console.log(`💾 Email saved: ${email.subject}`);
      return email;
    } catch (error) {
      console.error('Error saving email:', error);
      throw error;
    }
  }
  
// Headlines operations - bulk save
  async saveHeadlines(headlines, msgId, userId) {
    try {
      if (!headlines || headlines.length === 0) {
        return null;
      }

      const headlinesRecord = await this.prisma.headlines.create({
        data: {
          msgId: msgId,
          userId: userId,
          data: headlines, // Store as JSON array
          total: headlines.length
        }
      });

      console.log(`💾 Saved ${headlines.length} headlines for email`);
      return headlinesRecord;
    } catch (error) {
      console.error('Error saving headlines:', error);
      throw error;
    }
  }

  // Search results operations - bulk save
  async saveSearchResults(searchResults, msgId, userId) {
    try {
      if (!searchResults || searchResults.length === 0) {
        return null;
      }

      // Create map structure: headline -> results
      const searchMap = {};
      let totalSuccessful = 0;

      searchResults.forEach(result => {
        searchMap[result.headline] = {
          query: result.query || result.headline,
          success: result.success || false,
          totalFound: result.totalFound || 0,
          results: result.results || [],
          searchedAt: result.searchedAt || new Date().toISOString()
        };

        if (result.success) totalSuccessful++;
      });

      const searchRecord = await this.prisma.searchResults.create({
        data: {
          msgId: msgId,
          userId: userId,
          data: searchMap, // Store as JSON map
          total: searchResults.length,
          successful: totalSuccessful
        }
      });

      console.log(`💾 Saved search results: ${totalSuccessful}/${searchResults.length} successful`);
      return searchRecord;
    } catch (error) {
      console.error('Error saving search results:', error);
      throw error;
    }
  }

  // Scraped articles operations - bulk save
  async saveScrapedResults(scrapedData, msgId, userId) {
    try {
      if (!scrapedData || scrapedData.length === 0) {
        return null;
      }

      // Create map structure: headline -> scraped articles
      const scrapedMap = {};
      let totalArticles = 0;
      let successfulArticles = 0;

      scrapedData.forEach(headlineData => {
        const articles = [];
        
        if (headlineData.scrapedArticles) {
          headlineData.scrapedArticles.forEach(article => {
            articles.push({
              url: article.url,
              title: article.title,
              content: article.content,
              contentPreview: article.contentPreview,
              wordCount: article.wordCount || 0,
              success: article.success || false,
              error: article.error,
              scrapedAt: article.scrapedAt
            });

            totalArticles++;
            if (article.success) successfulArticles++;
          });
        }

        scrapedMap[headlineData.headline] = {
          searchSuccess: headlineData.searchSuccess || false,
          totalSearchResults: headlineData.totalSearchResults || 0,
          scrapedCount: headlineData.scrapedCount || 0,
          articles: articles
        };
      });

      const scrapedRecord = await this.prisma.scrapedResults.create({
        data: {
          msgId: msgId,
          userId: userId,
          data: scrapedMap, // Store as JSON map
          total: totalArticles,
          successful: successfulArticles
        }
      });

      console.log(`💾 Saved scraped results: ${successfulArticles}/${totalArticles} articles`);
      return scrapedRecord;
    } catch (error) {
      console.error('Error saving scraped results:', error);
      throw error;
    }
  }

  // Summaries operations - bulk save
  async saveSummaries(summaryData, msgId, userId) {
    try {
      if (!summaryData || summaryData.length === 0) {
        return null;
      }

      // Create map structure: headline -> summary
      const summaryMap = {};
      let successfulSummaries = 0;

      summaryData.forEach(summary => {
        summaryMap[summary.headline] = {
          success: summary.success || false,
          summary: summary.summary,
          wordCount: summary.wordCount || 0,
          reason: summary.reason,
          sourceArticle: summary.sourceArticle || null,
          totalArticlesChecked: summary.totalArticlesChecked || 0
        };

        if (summary.success) successfulSummaries++;
      });

      const summariesRecord = await this.prisma.summaries.create({
        data: {
          msgId: msgId,
          userId: userId,
          data: summaryMap, // Store as JSON map
          total: summaryData.length,
          successful: successfulSummaries
        }
      });

      console.log(`💾 Saved summaries: ${successfulSummaries}/${summaryData.length} successful`);
      return summariesRecord;
    } catch (error) {
      console.error('Error saving summaries:', error);
      throw error;
    }
  }

  // Get complete email processing data
  async getEmailProcessingData(msgId) {
    return await this.prisma.email.findUnique({
      where: { id: msgId },
      include: {
        headlines: true,
        searchResults: true,
        scrapedResults: true,
        summaries: true
      }
    });
  }

  // Get user's processing history
  async getUserHistory(userId, limit = 10) {
    return await this.prisma.email.findMany({
      where: { userId: userId },
      orderBy: { processedAt: 'desc' },
      take: limit,
      include: {
        headlines: true,
        summaries: true
      }
    });
  }

  // Get user's digest
  async getUserDigest(userId) {
    const recentEmails = await this.prisma.email.findMany({
      where: { userId: userId },
      orderBy: { processedAt: 'desc' },
      take: 5,
      include: {
        headlines: true,
        summaries: true
      }
    });

    // Format digest
    const digest = recentEmails.map(email => {
      const headlines = email.headlines?.data || [];
      const summaries = email.summaries?.data || {};
      
      return {
        msgId: email.id,
        subject: email.subject,
        from: email.fromName || email.fromEmail,
        processedAt: email.processedAt,
        totalHeadlines: email.headlines?.total || 0,
        successfulSummaries: email.summaries?.successful || 0,
        items: headlines.map(headline => ({
          headline: headline,
          summary: summaries[headline]?.summary || null,
          hasContent: summaries[headline]?.success || false
        }))
      };
    });

    return digest;
  }

  // Cleanup
  async disconnect() {
    await this.prisma.$disconnect();
  }
}

module.exports = DatabaseService;
