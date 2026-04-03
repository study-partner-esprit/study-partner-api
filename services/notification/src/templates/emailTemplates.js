/**
 * Email Templates for Study Partner
 * Professional, branded email templates for various notification types
 */

const templates = {
  /**
   * Email verification on registration
   */
  verificationEmail: (otpCode, verificationLink, name = "User") => ({
    subject: "🎓 Study Partner - Verify Your Email",
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 28px; margin: 0 0 10px 0; text-align: center;">Welcome to Study Partner! 🎉</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">Hi ${name}, thanks for signing up!</p>
          
          <div style="background: #f5f5f5; border-radius: 8px; padding: 30px; margin: 30px 0; text-align: center;">
            <p style="color: #999; margin: 0 0 10px 0; font-size: 14px;">Your verification code:</p>
            <h2 style="letter-spacing: 4px; margin: 15px 0; font-size: 32px; color: #333; font-family: monospace;">${otpCode}</h2>
            <p style="color: #999; margin: 10px 0; font-size: 12px;">⏱️ Code expires in 10 minutes</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Verify Email
            </a>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              If you didn't create this account, you can safely ignore this email.
            </p>
            <p style="color: #999; font-size: 12px; margin: 10px 0 0 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  }),

  /**
   * Password reset email
   */
  passwordResetEmail: (resetLink, name = "User", expiresIn = "1 hour") => ({
    subject: "🔐 Study Partner - Reset Your Password",
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 28px; margin: 0 0 10px 0; text-align: center;">Password Reset Request</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">Hi ${name},</p>
          
          <p style="color: #666; margin: 20px 0; line-height: 1.6;">
            We received a request to reset the password for your Study Partner account. 
            If you made this request, click the button below to set a new password.
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Reset Password
            </a>
          </div>
          
          <p style="color: #999; font-size: 13px; margin: 20px 0; text-align: center;">
            🕒 This link expires in ${expiresIn}
          </p>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="color: #856404; margin: 0; font-size: 13px;">
              <strong>⚠️ Security Tip:</strong> Never share this link with anyone. Study Partner staff will never ask for your password.
            </p>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              If you didn't request a password reset, you can safely ignore this email.
            </p>
            <p style="color: #999; font-size: 12px; margin: 10px 0 0 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  }),

  /**
   * Study reminder email
   */
  studyReminderEmail: (taskTitle, taskDueDate, name = "Student") => ({
    subject: "📚 Study Partner - Time to Study!",
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 28px; margin: 0 0 10px 0; text-align: center;">Hey ${name}, Time to Study! 📚</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">You have a pending task waiting for you</p>
          
          <div style="background: #f5f5f5; border-left: 4px solid #667eea; border-radius: 4px; padding: 20px; margin: 30px 0;">
            <h3 style="color: #333; margin: 0 0 10px 0; font-size: 18px;">${taskTitle}</h3>
            <p style="color: #666; margin: 0; font-size: 14px;">
              📅 Due: ${new Date(taskDueDate).toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          <p style="color: #666; margin: 20px 0; line-height: 1.6;">
            Keep your streak going and make progress towards your learning goals. Every task completed brings you closer to mastery!
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://study-partner.com/dashboard" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Start Studying
            </a>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  }),

  /**
   * Achievement/Level up notification
   */
  achievementEmail: (achievementName, newLevel, bonusXP = 0, name = "Student") => ({
    subject: `🎉 Study Partner - Level ${newLevel} Achieved!`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 32px; margin: 0 0 10px 0; text-align: center;">🎉 Congratulations! 🎉</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">You've unlocked a major achievement, ${name}!</p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; color: white;">
            <h2 style="margin: 0 0 10px 0; font-size: 24px;">${achievementName}</h2>
            <p style="margin: 10px 0; font-size: 18px;">🏆 Level <strong>${newLevel}</strong></p>
            ${bonusXP > 0 ? `<p style="margin: 10px 0; font-size: 16px;">+${bonusXP} Bonus XP 💪</p>` : ""}
          </div>
          
          <p style="color: #666; margin: 20px 0; line-height: 1.6; text-align: center;">
            Your dedication is paying off! Keep up the amazing work and continue challenging yourself.
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://study-partner.com/analytics" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              View Your Progress
            </a>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  }),

  /**
   * Subscription expiry reminder
   */
  subscriptionExpiryEmail: (daysRemaining, planName = "VIP", name = "Student") => ({
    subject: `⏰ Study Partner - Your ${planName} Plan Expires Soon`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 28px; margin: 0 0 10px 0; text-align: center;">Your Subscription Expires Soon ⏰</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">Hi ${name},</p>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; padding: 20px; margin: 20px 0;">
            <p style="color: #856404; margin: 0; font-size: 16px; font-weight: bold;">
              ⏱️ Your <strong>${planName}</strong> plan expires in <strong>${daysRemaining}</strong> ${daysRemaining === 1 ? 'day' : 'days'}
            </p>
          </div>
          
          <p style="color: #666; margin: 20px 0; line-height: 1.6;">
            Don't lose access to premium features while you're making great progress. 
            Renew your subscription now to keep the momentum going!
          </p>
          
          <ul style="color: #666; margin: 20px 0; padding-left: 20px; line-height: 2;">
            <li>📊 Advanced analytics and insights</li>
            <li>🤖 AI-powered study recommendations</li>
            <li>👥 Unlimited study sessions with friends</li>
            <li>📈 Priority support and more!</li>
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://study-partner.com/settings/subscription" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Renew Subscription
            </a>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  }),

  /**
   * Welcome email after verification
   */
  welcomeEmail: (name = "Student") => ({
    subject: "👋 Welcome to Study Partner - Get Started!",
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
          <h1 style="color: #333; font-size: 28px; margin: 0 0 10px 0; text-align: center;">Welcome to Study Partner! 🎓</h1>
          <p style="color: #666; text-align: center; margin: 0 0 30px 0;">Hi ${name}, you're all set!</p>
          
          <p style="color: #666; margin: 20px 0; line-height: 1.6;">
            Your account is now active and ready to go. Here's how to get started:
          </p>
          
          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #333; margin: 0 0 15px 0; font-size: 16px;">Getting Started Checklist:</h3>
            <div style="line-height: 2; color: #666; font-size: 14px;">
              <p style="margin: 0;">✅ <strong>Add your first subject</strong> - Create topics you want to study</p>
              <p style="margin: 0;">✅ <strong>Upload course materials</strong> - PDFs, notes, resources</p>
              <p style="margin: 0;">✅ <strong>Set your study plan</strong> - Create tasks and schedule</p>
              <p style="margin: 0;">✅ <strong>Start studying</strong> - Begin your first session!</p>
            </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://study-partner.com/subjects" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Get Started Now
            </a>
          </div>
          
          <div style="background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px; padding: 15px; margin: 20px 0;">
            <p style="color: #1565c0; margin: 0; font-size: 13px;">
              <strong>💡 Pro Tip:</strong> Check out our learning guides and join the community to connect with other students!
            </p>
          </div>
          
          <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
              Questions? Visit our <a href="https://study-partner.com/help" style="color: #667eea; text-decoration: none;">Help Center</a> or contact <a href="mailto:support@study-partner.com" style="color: #667eea; text-decoration: none;">support@study-partner.com</a>
            </p>
            <p style="color: #999; font-size: 12px; margin: 10px 0 0 0; text-align: center;">
              © 2026 Study Partner. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  })
};

module.exports = templates;
