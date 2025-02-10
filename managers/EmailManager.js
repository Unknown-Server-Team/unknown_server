const nodemailer = require('nodemailer');
const LogManager = require('./LogManager');

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
        const verificationUrl = `${process.env.APP_URL}/api/auth/verify-email/${token}`;
        const html = `
            <h1>Welcome to ${process.env.APP_NAME}!</h1>
            <p>Please verify your email address by clicking the link below:</p>
            <a href="${verificationUrl}">Verify Email</a>
            <p>If you didn't create this account, you can safely ignore this email.</p>
        `;
        return this.sendEmail(user.email, 'Verify your email', html);
    }

    async sendPasswordResetEmail(user, token) {
        const resetUrl = `${process.env.APP_URL}/reset-password/${token}`;
        const html = `
            <h1>Password Reset Request</h1>
            <p>You requested to reset your password. Click the link below to proceed:</p>
            <a href="${resetUrl}">Reset Password</a>
            <p>If you didn't request this, you can safely ignore this email.</p>
            <p>This link will expire in 1 hour.</p>
        `;
        return this.sendEmail(user.email, 'Reset your password', html);
    }
}

module.exports = new EmailManager();