import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "./logger.js";

let transporter = null;

function getTransporter() {
  if (!transporter && config.smtpHost) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
  }
  return transporter;
}

export async function sendAlert(subject, message, errorDetails = null) {
  if (!config.alertEmailTo) {
    logger.warn("Alert email not configured – skipping");
    return;
  }

  try {
    const transporter = getTransporter();
    if (!transporter) {
      logger.warn("SMTP not configured – cannot send alert");
      return;
    }
    let text = message;
    if (errorDetails) {
      text += `\n\nError details:\n${errorDetails.stack || errorDetails}`;
    }
    await transporter.sendMail({
      from: config.alertEmailFrom,
      to: config.alertEmailTo,
      subject: `[Stock Report] ${subject}`,
      text,
    });
    logger.info(`Alert sent: ${subject}`);
  } catch (err) {
    logger.error({ err }, "Failed to send alert email");
  }
}
