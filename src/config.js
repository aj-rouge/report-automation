import dotenv from 'dotenv';
dotenv.config();

export const config = {
  baselinkerApiKey: process.env.BASELINKER_API_KEY,
  tenantId: process.env.TENANT_ID,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  siteId: process.env.SITE_ID,
  siteName: process.env.SITE_NAME,
  customerDataFolder: process.env.CUSTOMER_DATA_FOLDER || 'stock_reports',
  alertEmailTo: process.env.ALERT_EMAIL_TO,
  alertEmailFrom: process.env.ALERT_EMAIL_FROM,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: parseInt(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
};