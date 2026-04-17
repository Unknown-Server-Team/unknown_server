import type {
    MailInfo,
    NodemailerModule,
    Transporter,
    EmailTemplateData,
    EmailTemplates,
    EmailUser
} from '../types/email';
import type { LogManagerModule, VersionManagerModule } from '../types/modules';

const nodemailer = require('nodemailer') as NodemailerModule;
const LogManager = require('./LogManager') as LogManagerModule;
const VersionManager = require('./VersionManager') as VersionManagerModule;

class EmailManager {
    private transporter: Transporter;
    private templates: EmailTemplates;

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
        this.templates = {
            verification: this.getDefaultVerificationTemplate(),
            passwordReset: this.getDefaultPasswordResetTemplate()
        };
    }

    getActiveApiVersion(): string {
        try {
            const supportedVersions = VersionManager.getSupportedVersions();
            return supportedVersions
                .filter((version: string): boolean => !VersionManager.isDeprecated(version))
                .sort()
                .pop() || 'v1';
        } catch (error: unknown) {
            LogManager.error('Failed to get active API version', error);
            return 'v1';
        }
    }

    async sendEmail(to: string, subject: string, html: string): Promise<MailInfo> {
        try {
            const info = await this.transporter.sendMail({
                from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
                to,
                subject,
                html
            });
            LogManager.info('Email sent successfully', { messageId: info.messageId });
            return info;
        } catch (error: unknown) {
            LogManager.error('Failed to send email', error);
            throw error;
        }
    }

    async sendVerificationEmail(user: EmailUser, token: string): Promise<MailInfo> {
        try {
            const apiVersion = this.getActiveApiVersion();
            const verificationUrl = `${process.env.APP_URL}/api/${apiVersion}/auth/verify-email/${token}`;
            const html = this.processTemplate(this.templates.verification, {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: user.name || user.email,
                verificationUrl,
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL
            });
            return await this.sendEmail(user.email, `Verify your email for ${process.env.APP_NAME || 'Unknown Server'}`, html);
        } catch (error: unknown) {
            LogManager.error('Failed to send verification email', error);
            throw error;
        }
    }

    async sendPasswordResetEmail(user: EmailUser, token: string): Promise<MailInfo> {
        try {
            this.getActiveApiVersion();
            const resetUrl = `${process.env.APP_URL}/reset-password/${token}`;
            const html = this.processTemplate(this.templates.passwordReset, {
                appName: process.env.APP_NAME || 'Unknown Server',
                userName: user.name || user.email,
                resetUrl,
                expirationTime: '1 hour',
                supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL
            });
            return await this.sendEmail(user.email, `Reset your password for ${process.env.APP_NAME || 'Unknown Server'}`, html);
        } catch (error: unknown) {
            LogManager.error('Failed to send password reset email', error);
            throw error;
        }
    }

    processTemplate(template: string, data: EmailTemplateData): string {
        let processed = template;
        Object.entries(data).forEach(([key, value]: [string, string | undefined]): void => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            processed = processed.replace(regex, value || '');
        });
        return processed;
    }

    getDefaultVerificationTemplate(): string {
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

    getDefaultPasswordResetTemplate(): string {
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

const emailManager = new EmailManager();

module.exports = emailManager;
module.exports.EmailManager = emailManager;
