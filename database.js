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
  
  async disconnect() {
    await this.prisma.$disconnect();
  }
}

module.exports = DatabaseService;
