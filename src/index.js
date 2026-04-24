import { generateStockReport } from "./reports/reportGenerator.js";
import { uploadToSharePoint } from "./services/sharepoint.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { sendAlert } from "./utils/alert.js";

/**
 * Returns true if we should generate the report based on current UK time.
 * Rules:
 * - Friday 11:30 – 11:40
 * - Monday 00:00 – 00:05  (Sunday midnight report)
 * - Last day of month 00:00 – 00:10
 *
 * Manual override via FORCE_REPORT=true environment variable.
 */
function shouldGenerateReport() {
  // Force override (e.g., via workflow_dispatch input)
  if (process.env.FORCE_REPORT === "true") {
    logger.info("FORCE_REPORT=true – overriding date/time checks");
    return true;
  }

  const now = new Date();
  const ukTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/London" }),
  );
  const hour = ukTime.getHours();
  const minute = ukTime.getMinutes();
  const dayOfWeek = ukTime.getDay(); // 0 = Sunday, 1 = Monday, 5 = Friday
  const isLastDayOfMonth =
    new Date(ukTime.getFullYear(), ukTime.getMonth() + 1, 0).getDate() ===
    ukTime.getDate();

  // Friday 11:30 – 11:40
  if (dayOfWeek === 5 && hour === 11 && minute >= 30 && minute <= 40) {
    logger.info("Friday 11:30-11:40 UK time – running report");
    return true;
  }

  // Monday 00:00 – 00:05 (Sunday midnight report)
  if (dayOfWeek === 1 && hour === 0 && minute <= 5) {
    logger.info("Monday 00:00-00:05 UK time – running Sunday midnight report");
    return true;
  }

  // Last day of month 00:00 – 00:10
  if (isLastDayOfMonth && hour === 0 && minute <= 10) {
    logger.info(
      "Last day of month 00:00-00:10 UK time – running end-of-month report",
    );
    return true;
  }

  logger.info(
    { hour, minute, dayOfWeek, isLastDayOfMonth },
    "Not a scheduled time – exiting without generating report",
  );
  return false;
}

(async () => {
  const startTime = Date.now();
  try {
    logger.info("Stock report job triggered");

    if (!shouldGenerateReport()) {
      logger.info("Graceful exit – no report needed");
      return;
    }

    // Generate the report buffer
    const buffer = await generateStockReport();

    // Create dynamic folder path: YYYY/MM
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dynamicFolder = `${config.customerDataFolder}/${year}/${month}`;
    logger.info({ dynamicFolder }, "Using dynamic folder structure");

    // File name with date
    const fileName = `stock_report_${now.toISOString().slice(0, 10)}.xlsx`;

    // Upload to SharePoint inside the dynamic folder
    await uploadToSharePoint(buffer, fileName, dynamicFolder);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`Stock report completed successfully in ${duration}s`);
  } catch (err) {
    logger.error({ err }, "Stock report job failed");
    await sendAlert("Stock Report Failed", err.message, err);
    process.exit(1);
  }
})();
