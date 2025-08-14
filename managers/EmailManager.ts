import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';

const LogManager = require('./LogManager');
const VersionManager = require('./VersionManager');

// Email configuration interface
interface EmailConfig {
    host?: string;
    port?: number;
    secure: boolean;
    auth: {
        user?: string;
        pass?: string;
    };
}

// Email template data interface
interface EmailTemplateData {
    [key: string]: string;
}

// Email templates interface
interface EmailTemplates {
    verification: string;
    passwordReset: string;
}

// Send mail result interface
interface SendMailResult {
    messageId: string;
    accepted?: string[];
    rejected?: string[];
}

class EmailManager {
    private transporter: Transporter;
    private templates: EmailTemplates;

    constructor() {
        const config: EmailConfig = {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        };

        this.transporter = nodemailer.createTransporter(config);
        
        // Load email templates from default ones
        this.templates = {
            verification: this.getDefaultVerificationTemplate(),
            passwordReset: this.getDefaultPasswordResetTemplate()
        };
    }

    // Get the latest non-deprecated API version
    private getActiveApiVersion(): string {
        try {
            // Get all supported versions
            const supportedVersions: string[] = VersionManager.getSupportedVersions();
            
            // Filter out deprecated versions and get the latest
            return supportedVersions
                .filter((v: string) => !VersionManager.isDeprecated(v))
                .sort()
                .pop() || 'v1'; // Default to v1 as fallback
        } catch (error) {
            LogManager.error('Failed to get active API version', error);
            return 'v1'; // Default to v1 in case of error
        }
    }

    async sendEmail(to: string, subject: string, html: string): Promise<SendMailResult | null> {
        try {
            const mailOptions: SendMailOptions = {
                from: `"${process.env.SMTP_FROM_NAME || 'Unknown Server'}" <${process.env.SMTP_FROM_EMAIL}>`,
                to,
                subject,
                html
            };

            const info = await this.transporter.sendMail(mailOptions);
            LogManager.info('Email sent successfully', { messageId: info.messageId });
            return info;
        } catch (error) {
            LogManager.error('Failed to send email', error);
            return null;
        }
    }

    async sendVerificationEmail(email: string, token: string): Promise<boolean> {
        try {
            const apiVersion = this.getActiveApiVersion();
            const verificationUrl = `${process.env.APP_URL}/api/${apiVersion}/auth/verify-email/${token}`;
            
            const templateData: EmailTemplateData = {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: email,
                verificationUrl,
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL || 'support@example.com'
            };

            const html = this.processTemplate(this.templates.verification, templateData);
            const result = await this.sendEmail(email, 'Verify Your Email Address', html);
            
            return result !== null;
        } catch (error) {
            LogManager.error('Failed to send verification email', error);
            return false;
        }
    }

    async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
        try {
            const apiVersion = this.getActiveApiVersion();
            const resetUrl = `${process.env.APP_URL}/api/${apiVersion}/auth/reset-password/${token}`;
            
            const templateData: EmailTemplateData = {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: email,
                resetUrl,
                expirationTime: '1 hour',
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL || 'support@example.com'
            };

            const html = this.processTemplate(this.templates.passwordReset, templateData);
            const result = await this.sendEmail(email, 'Reset Your Password', html);
            
            return result !== null;
        } catch (error) {
            LogManager.error('Failed to send password reset email', error);
            return false;
        }
    }

    // Process a template by replacing variables with actual values
    private processTemplate(template: string, data: EmailTemplateData): string {
        let processed = template;
        Object.entries(data).forEach(([key, value]) => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            processed = processed.replace(regex, value);
        });
        return processed;
    }
    
    // Default email template for verification
    private getDefaultVerificationTemplate(): string {
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
    private getDefaultPasswordResetTemplate(): string {
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

export = new EmailManager();