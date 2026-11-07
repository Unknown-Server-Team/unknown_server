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
