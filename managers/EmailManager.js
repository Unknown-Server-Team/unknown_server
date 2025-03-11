const nodemailer = require('nodemailer');
const LogManager = require('./LogManager');
const VersionManager = require('./VersionManager');

class EmailManager {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        // Load email templates from default ones
        this.templates = {
            verification: this.getDefaultVerificationTemplate(),
            passwordReset: this.getDefaultPasswordResetTemplate()
        };
    }

    // Get the latest non-deprecated API version
    getActiveApiVersion() {
        try {
            // Get all supported versions
            const supportedVersions = VersionManager.getSupportedVersions();
            
            // Filter out deprecated versions and get the latest
            return supportedVersions
                .filter(v => !VersionManager.isDeprecated(v))
                .sort()
                .pop() || 'v1'; // Default to v1 as fallback
        } catch (error) {
            LogManager.error('Failed to get active API version', error);
            return 'v1'; // Default to v1 in case of error
        }
    }

    async sendEmail(to, subject, html) {
        try {
            const info = await this.transporter.sendMail({
                from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
                to,
                subject,
                html
            });
            LogManager.info('Email sent successfully', { messageId: info.messageId });
            return info;
        } catch (error) {
            LogManager.error('Failed to send email', error);
            throw error;
        }
    }

    async sendVerificationEmail(user, token) {
        try {
            // Get active API version for the URL
            const apiVersion = this.getActiveApiVersion();
            const verificationUrl = `${process.env.APP_URL}/api/${apiVersion}/auth/verify-email/${token}`;
            
            // Process template with data
            const html = this.processTemplate(this.templates.verification, {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: user.name || user.email,
                verificationUrl,
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL
            });
            
            return await this.sendEmail(user.email, `Verify your email for ${process.env.APP_NAME || 'Unknown Server'}`, html);
        } catch (error) {
            LogManager.error('Failed to send verification email', error);
            throw error;
        }
    }

    async sendPasswordResetEmail(user, token) {
        try {
            // Get active API version for the URL
            const apiVersion = this.getActiveApiVersion();
            const resetUrl = `${process.env.APP_URL}/reset-password/${token}`;
            
            // Process template with data
            const html = this.processTemplate(this.templates.passwordReset, {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: user.name || user.email,
                resetUrl,
                expirationTime: '1 hour',
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL
            });
            
            return await this.sendEmail(user.email, `Reset your password for ${process.env.APP_NAME || 'Unknown Server'}`, html);
        } catch (error) {
            LogManager.error('Failed to send password reset email', error);
            throw error;
        }
    }
    
    // Process a template by replacing variables with actual values
    processTemplate(template, data) {
        let processed = template;
        Object.entries(data).forEach(([key, value]) => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            processed = processed.replace(regex, value);
        });
        return processed;
    }
    
    // Default email template for verification
    getDefaultVerificationTemplate() {
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1>Welcome to {{appName}}!</h1>
                <p>Hello {{userName}},</p>
                <p>Please verify your email address by clicking the link below:</p>
                <p>
                    <a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 15px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">
                        Verify Email
                    </a>
                </p>
                <p>If you didn't create this account, you can safely ignore this email.</p>
                <p>For support, please contact <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p>
            </div>
        `;
    }
    
    // Default email template for password reset
    getDefaultPasswordResetTemplate() {
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1>Password Reset Request</h1>
                <p>Hello {{userName}},</p>
                <p>You requested to reset your password. Click the link below to proceed:</p>
                <p>
                    <a href="{{resetUrl}}" style="display: inline-block; padding: 10px 15px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 4px;">
                        Reset Password
                    </a>
                </p>
                <p>If you didn't request this, you can safely ignore this email.</p>
                <p>This link will expire in {{expirationTime}}.</p>
                <p>For support, please contact <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p>
            </div>
        `;
    }
}

module.exports = new EmailManager();