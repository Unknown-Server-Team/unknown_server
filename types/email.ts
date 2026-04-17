export interface MailInfo {
    messageId: string;
    [key: string]: unknown;
}

export interface MailOptions {
    from: string;
    to: string;
    subject: string;
    html: string;
}

export interface Transporter {
    sendMail(options: MailOptions): Promise<MailInfo>;
}

export interface NodemailerModule {
    createTransport(options: {
        host?: string;
        port?: string;
        secure: boolean;
        auth: {
            user?: string;
            pass?: string;
        };
    }): Transporter;
}

export interface EmailTemplateData {
    [key: string]: string | undefined;
}

export interface EmailTemplates {
    verification: string;
    passwordReset: string;
}

export interface EmailUser {
    email: string;
    name?: string | null;
}
