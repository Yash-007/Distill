const {PrismaClient} = require('@prisma/client')

class DatabaseService {
  constructor () {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    })
  }

  async findOrCreateUser(email) {
    try {
      let user = await this.prisma.user.findUnique({
        where: {id: email}
      });

      if (!user) {
        console.log(`Creating new user: ${email}`)
        user = await this.prisma.user.create({
          data: {id:email}
        });
      }
      return user;
    } catch (error) {
      console.error('Error in findOrCreateUser:', error)
      throw error;
    }
  }

  async saveEmail(emailData, userId) {
    try {
      const existing = await this.prisma.email.findUnique({
        where: {gmailId: emailData.id} 
      }); 
  
      if (existing) {
        console.log(`Email already processed: ${emailData.subject}`);
        return existing;
      }
  
      const email = await this.prisma.email.create({
        data: {
          userId : userId,
          gmailId: emailData.id,
          subject: emailData.subject,
          fromEmail: emailData.senderEmail,
          fromName: emailData.from,
          content: emailData.body || '',
          cleanedBody: emailData.cleanedBody || '',
          linkCount: emailData?.links?.length || 0,
          wordCount : emailData.cleanedBody?.split(/\s+/).length || 0,
          receivedAt: new Date(emailData.date)
        }
      });
  
      console.log(`Email saved: ${email.subject}`)
      return email;   
    } catch (error) {
      console.error("Error saving email:", error);
      throw error;
    }
  }

  async saveHeadlines(headlines, msgId, userId){
      try {
       const savedHeadlines = await this.prisma.headlines.create({
          data : {
            userId: userId,
            msgId: msgId,
            data : headlines,
            total : headlines.length
          }
        });

        console.log(`Saved ${savedHeadlines.total} headlines for message ID: ${msgId}`);
      } catch (error) {
        console.error("Error saving headlines:", error);
        throw error;
      }
}

async saveSearchResults(results, msgId, userId) {
    try {
      // Save new search results
      const saved = await this.prisma.searchResults.create({
        data: {
          msgId,
          userId,
          data: results,
          total: Array.isArray(results) ? results.length : 0,
          successful: Array.isArray(results)
            ? results.filter(r => r.success).length
            : 0
        }
      });
      console.log(`Saved search results for msgId: ${msgId}`);
    } catch (error) {
      console.error("Error saving search results:", error);
      throw error;
    }
  }

   async saveScrapedResults(results, msgId, userId) {
    try {
      // Save new scraped results
      const successful = Array.isArray(results)
        ? results.filter(r => r.scrapedArticles && r.scrapedArticles.length > 0).length
        : 0;
      const total = Array.isArray(results) ? results.length : 0;
      const saved = await this.prisma.scrapedResults.create({
        data: {
          msgId,
          userId,
          data: results,
          total,
          successful
        }
      });
      console.log(`Saved scraped results for msgId: ${msgId}`);
    } catch (error) {
      console.error("Error saving scraped results:", error);
      throw error;
    }
  }

    async saveSummaries(summaries, msgId, userId) {
    try {
      // Save new summaries
      const successful = Array.isArray(summaries)
        ? summaries.filter(s => s.success).length
        : 0;
      const total = Array.isArray(summaries) ? summaries.length : 0;
      const saved = await this.prisma.summaries.create({
        data: {
          msgId,
          userId,
          data: summaries,
          total,
          successful
        }
      });
      console.log(`Saved summaries for msgId: ${msgId}`);
    } catch (error) {
      console.error("Error saving summaries:", error);
      throw error;
    }
  }

  async getEmailProcessingData(msgId) {
    try {
      const emailData = await this.prisma.email.findUnique({
      where: { id: msgId },
      include: {
      headlines: true,
      searchResults: true,
      scrapedResults: true,
      summaries: true,
  }  
 });
return emailData;
    } catch (error) {
      console.error("Error fetching email processed data:", error);
      throw error;
    }
  }
}

module.exports = DatabaseService;