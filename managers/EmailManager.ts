import nodemailer from 'nodemailer';
import type { SentMessageInfo, Transporter } from 'nodemailer';
import type {
    EmailTemplateData,
    EmailTemplates,
    EmailUser
} from '../types/email';
import type { LogManagerModule, VersionManagerModule } from '../types/modules';
import LogManagerImport from './LogManager';
import VersionManagerImport from './VersionManager';

const LogManager = LogManagerImport as unknown as LogManagerModule;
const VersionManager = VersionManagerImport as unknown as VersionManagerModule;

const DEFAULT_SMTP_PORT = 587;

class EmailManager {
    private transporter: Transporter<SentMessageInfo> | null;
    private templates: EmailTemplates;

    constructor() {
        this.transporter = this.createTransporter();
        this.templates = {
            verification: this.getDefaultVerificationTemplate(),
            passwordReset: this.getDefaultPasswordResetTemplate()
        };
    }

    isConfigured(): boolean {
        return this.transporter !== null;
    }

    private createTransporter(): Transporter<SentMessageInfo> | null {
        const host = process.env.SMTP_HOST?.trim();
        if (!host) {
            LogManager.warning('SMTP_HOST is not set; outgoing email is disabled');
            return null;
        }

        const parsedPort = Number.parseInt(process.env.SMTP_PORT || '', 10);
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        return nodemailer.createTransport({
            host,
            port: Number.isNaN(parsedPort) ? DEFAULT_SMTP_PORT : parsedPort,
            secure: process.env.SMTP_SECURE === 'true',
            auth: user && pass ? { user, pass } : undefined
        });
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

    async sendEmail(to: string, subject: string, html: string): Promise<SentMessageInfo | null> {
        if (!this.transporter) {
            LogManager.warning('Email not sent because SMTP is not configured', { subject });
            return null;
        }

        try {
            const info: SentMessageInfo = await this.transporter.sendMail({
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

    async sendVerificationEmail(user: EmailUser, token: string): Promise<SentMessageInfo | null> {
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

    async sendPasswordResetEmail(user: EmailUser, token: string): Promise<SentMessageInfo | null> {
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

export = emailManager;
