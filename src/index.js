import { generateStockReport } from "./reports/reportGenerator.js";
import { uploadToSharePoint } from "./services/sharepoint.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { sendAlert } from "./utils/alert.js";

(async () => {
  const startTime = Date.now();
  try {
    logger.info("Starting stock report job");

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
