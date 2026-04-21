import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export async function createGraphClient() {
  const credential = new ClientSecretCredential(
    config.tenantId,
    config.clientId,
    config.clientSecret,
  );
  const accessToken = await credential.getToken(
    "https://graph.microsoft.com/.default",
  );
  return Client.init({ authProvider: (done) => done(null, accessToken.token) });
}

function extractHostnameAndSiteName(possibleSiteId, siteName) {
  let hostname = null;
  let site = siteName || null;
  if (possibleSiteId?.includes(".sharepoint.com"))
    hostname = possibleSiteId.split(",")[0];
  if (site?.includes(".sharepoint.com")) {
    hostname ??= site.split(",")[0];
    if (site.includes("/sites/"))
      site = site.substring(site.indexOf("/sites/") + "/sites/".length);
  }
  if (!hostname && possibleSiteId?.includes(","))
    hostname = possibleSiteId.split(",")[0];
  if (!hostname || !site)
    throw new Error(
      "Insufficient configuration to determine hostname and site name",
    );
  return { hostname, site };
}

async function resolveWithTry(client, path, label) {
  try {
    const resp = await client.api(path).get();
    if (resp?.id) {
      logger.debug(`Resolved ${label}: ${resp.id}`);
      return resp.id;
    }
  } catch (err) {
    logger.warn({ err }, `${label} resolution failed`);
  }
  return null;
}

export async function resolveSharePointSite(client, configOverride = {}) {
  const cfg = { ...config, ...configOverride };
  const possibleSiteId = cfg.siteId || null;
  let lastErr = null;

  if (possibleSiteId) {
    const id = await resolveWithTry(
      client,
      `/sites/${possibleSiteId}`,
      "config.siteId",
    );
    if (id) return id;
  }
  try {
    const { hostname, site } = extractHostnameAndSiteName(
      possibleSiteId,
      cfg.siteName,
    );
    const id = await resolveWithTry(
      client,
      `/sites/${hostname}:/sites/${site}`,
      "hostname+siteName",
    );
    if (id) return id;
  } catch (err) {
    lastErr ??= err;
  }
  if (cfg.siteName) {
    const id = await resolveWithTry(
      client,
      `/sites/${cfg.siteName}`,
      `fallback /sites/${cfg.siteName}`,
    );
    if (id) return id;
  }
  throw new Error(
    `Unable to resolve SharePoint site. ${lastErr ? `Last error: ${lastErr.message}` : ""}`,
  );
}

export async function getDriveId(client, siteId) {
  const driveId = await resolveWithTry(
    client,
    `/sites/${siteId}/drive`,
    "drive",
  );
  if (!driveId) throw new Error(`Failed to resolve drive for site "${siteId}"`);
  logger.debug(`Resolved drive id: ${driveId}`);
  return driveId;
}

export async function ensureFolderExists(client, driveId, folderPath) {
  const segments = folderPath.split("/").filter((s) => s);
  let currentPath = "";
  for (const seg of segments) {
    currentPath += (currentPath ? "/" : "") + seg;
    try {
      await client.api(`/drives/${driveId}/root:/${currentPath}`).get();
    } catch {
      await client
        .api(`/drives/${driveId}/root:/${currentPath}`)
        .patch({ folder: {} });
      logger.info(`Created folder: ${currentPath}`);
    }
  }
  return { id: "folder_created", path: currentPath };
}

function encodePath(...segments) {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

export async function uploadFile(
  client,
  driveId,
  folderName,
  fileName,
  buffer,
) {
  const fileSize = buffer.length;
  const uploadPath = `/drives/${driveId}/root:/${encodePath(folderName, fileName)}:/content`;

  if (fileSize < 4 * 1024 * 1024) {
    await client.api(uploadPath).put(buffer);
    logger.info(
      `Uploaded small file: ${folderName}/${fileName} (${(fileSize / 1024).toFixed(2)} KB)`,
    );
    return { success: true, method: "PUT" };
  }

  logger.info(
    `Starting large file upload: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
  );
  const session = await client
    .api(
      `/drives/${driveId}/root:/${encodePath(folderName, fileName)}:/createUploadSession`,
    )
    .post({
      item: { "@microsoft.graph.conflictBehavior": "replace", name: fileName },
    });
  const uploadUrl = session.uploadUrl;
  const chunkSize = 3276800;
  let start = 0;
  while (start < fileSize) {
    const end = Math.min(start + chunkSize, fileSize);
    const chunk = buffer.slice(start, end);
    await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": chunk.length,
        "Content-Range": `bytes ${start}-${end - 1}/${fileSize}`,
      },
      body: chunk,
    });
    start = end;
  }
  logger.info(`Completed large file upload: ${folderName}/${fileName}`);
  return { success: true, method: "chunked" };
}

export async function uploadToSharePoint(
  buffer,
  fileName,
  folderName = config.customerDataFolder,
) {
  const client = await createGraphClient();
  const siteId = await resolveSharePointSite(client, config);
  const driveId = await getDriveId(client, siteId);
  await ensureFolderExists(client, driveId, folderName);
  await uploadFile(client, driveId, folderName, fileName, buffer);
  logger.info(`Uploaded ${fileName} to SharePoint`);
  return { fileName, siteId };
}
