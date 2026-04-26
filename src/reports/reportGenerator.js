import {
  getDefaultInventoryId,
  getAllProductIds,
  getProductsData,
  getWarehouses,
  getPriceGroups,
  getReservedQuantities,
  extractLocationMap,
} from "../services/baselinker.js";
import {
  createWorkbook,
  addStyledSheet,
  styleRows,
  addTable,
} from "../utils/excelUtils.js";
import { logger } from "../utils/logger.js";

function flattenProductsToRows(
  products,
  warehouses,
  priceGroups,
  locationMap,
  reservedMap,
) {
  const rows = [];
  for (const product of products) {
    rows.push(
      createRow(
        product,
        null,
        warehouses,
        priceGroups,
        locationMap,
        reservedMap,
      ),
    );
    if (product.variants) {
      if (Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          const variantId =
            variant.variant_id ?? variant.id ?? variant.product_id;
          if (variantId) {
            rows.push(
              createRow(
                variant,
                product.product_id,
                warehouses,
                priceGroups,
                locationMap,
                reservedMap,
                variantId,
              ),
            );
          }
        }
      } else if (typeof product.variants === "object") {
        for (const [variantId, variant] of Object.entries(product.variants)) {
          rows.push(
            createRow(
              variant,
              product.product_id,
              warehouses,
              priceGroups,
              locationMap,
              reservedMap,
              parseInt(variantId, 10),
            ),
          );
        }
      }
    }
  }
  return rows;
}

// Add this helper before createRow
function getProductName(item, fallbackId = null) {
  // Try common top-level fields
  let name = item.name ?? item.product_name ?? item.title;
  // If not found, look inside text_fields
  if (!name && item.text_fields && typeof item.text_fields === "object") {
    name = item.text_fields.name;
  }
  // Return first non-empty string
  if (name && name !== "") return name;
  return "—";
}

function createRow(
  item,
  parentId,
  warehouses,
  priceGroups,
  locationMap,
  reservedMap,
  forcedId = null,
) {
  const productId = forcedId || item.product_id;
  const stock = item.stock || {};
  const prices = item.prices || {};

  const productName = getProductName(item, productId);

  // Warehouse stock
  const warehouseStock = {};
  for (const wh of warehouses) {
    const key = `${wh.warehouse_type}_${wh.warehouse_id}`;
    warehouseStock[wh.warehouse_id] = Number(
      stock[key] ?? stock[wh.warehouse_id] ?? 0,
    );
  }

  // Prices for each price group
  const priceValues = {};
  for (const pg of priceGroups) {
    const price = prices[pg.price_group_id.toString()];
    priceValues[pg.price_group_id] =
      price !== undefined && price !== null ? Number(price).toFixed(2) : "—";
  }

  const reserved = reservedMap[productId] || 0;
  const totalStock = Object.values(warehouseStock).reduce((a, b) => a + b, 0);
  const actualStock = totalStock + reserved;

  return {
    product_id: productId,
    parent_id: parentId || "—",
    name: productName,
    ean: item.ean || "—",
    sku: item.sku || "—",
    location: locationMap[productId] || "—",
    ...warehouseStock,
    ...priceValues,
    reserved,
    actual_stock: actualStock,
  };
}

export async function generateStockReport() {
  logger.info("Starting stock report generation");
  const inventoryId = await getDefaultInventoryId();
  const productIds = await getAllProductIds(inventoryId);
  if (!productIds.length) throw new Error("No products found");

  const productsDetails = await getProductsData(inventoryId, productIds);

  const mainProductCount = productsDetails.filter(
    (p) =>
      !p.parent_id && (!p.variants || Object.keys(p.variants).length === 0),
  ).length;
  const productWithVariantsCount = productsDetails.filter(
    (p) => p.variants && Object.keys(p.variants).length > 0,
  ).length;
  logger.info(
    {
      mainProductCount,
      productWithVariantsCount,
      totalProductObjects: productsDetails.length,
    },
    "Product breakdown",
  );

  const warehouses = await getWarehouses();
  const priceGroups = await getPriceGroups();
  const locationMap = extractLocationMap(productsDetails);
  const reservedMap = await getReservedQuantities();

  const rows = flattenProductsToRows(
    productsDetails,
    warehouses,
    priceGroups,
    locationMap,
    reservedMap,
  );
  if (!rows.length) throw new Error("No rows to export");

  // Filter out products with zero actual stock
  let filteredRows = rows.filter((row) => row.actual_stock !== 0);
  logger.info(
    { beforeFilter: rows.length, afterFilter: filteredRows.length },
    "Filtered out zero actual stock products",
  );

  // Sort by location (alphabetical, case-insensitive), then by name
  filteredRows.sort((a, b) => {
    const locA = (a.location || "—").toLowerCase();
    const locB = (b.location || "—").toLowerCase();
    const locCompare = locA.localeCompare(locB);
    if (locCompare !== 0) return locCompare;
    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
  logger.info("Rows sorted by location and name");

  const mainProductRows = filteredRows.filter(
    (r) => r.parent_id === "—",
  ).length;
  const variantRows = filteredRows.filter((r) => r.parent_id !== "—").length;
  logger.info(
    { totalRows: filteredRows.length, mainProductRows, variantRows },
    "Final rows after filter and sort",
  );

  // Build headers including extra comment columns at the end
  const headers = [
    "Product ID",
    "Parent ID",
    "Product Name",
    "EAN",
    "SKU",
    "Location(s)",
    ...priceGroups.map((pg) => `${pg.name} Price (${pg.currency})`),
    ...warehouses.map((wh) => `${wh.name} (stock)`),
    "Reserved (orders)",
    "Actual Stock",
  ];

  const extraColumns = [
    "Jasmin count",
    "Match",
    "Jasmin Comments #1",
    "Jasmin Comments #2",
    "AJ Comments #1",
    "AJ Comments #2",
  ];
  headers.push(...extraColumns);

  const workbook = createWorkbook();
  const sheetName = "Stock Report";
  const columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.max(15, h.length + 2),
  }));
  const sheet = addStyledSheet(workbook, sheetName, columns);

  for (const row of filteredRows) {
    const rowData = {};
    rowData["Product ID"] = row.product_id;
    rowData["Parent ID"] = row.parent_id;
    rowData["Product Name"] = row.name;
    rowData["EAN"] = row.ean;
    rowData["SKU"] = row.sku;
    rowData["Location(s)"] = row.location;
    for (const pg of priceGroups) {
      rowData[`${pg.name} Price (${pg.currency})`] = row[pg.price_group_id];
    }
    for (const wh of warehouses) {
      rowData[`${wh.name} (stock)`] = row[wh.warehouse_id];
    }
    rowData["Reserved (orders)"] = row.reserved;
    rowData["Actual Stock"] = row.actual_stock;
    // Add empty values for extra columns
    for (const extra of extraColumns) {
      rowData[extra] = "";
    }
    sheet.addRow(rowData);
  }

  styleRows(sheet);

  // Table rows for Excel table – include empty strings for extra columns
  const tableRows = filteredRows.map((r) => [
    r.product_id,
    r.parent_id,
    r.name,
    r.ean,
    r.sku,
    r.location,
    ...priceGroups.map((pg) => r[pg.price_group_id]),
    ...warehouses.map((wh) => r[wh.warehouse_id]),
    r.reserved,
    r.actual_stock,
    "",
    "",
    "",
    "",
    "",
    "", // six empty strings for the extra columns
  ]);
  addTable(sheet, headers, tableRows, { name: "StockTable" });

  const buffer = await workbook.xlsx.writeBuffer();
  logger.info(
    `Stock report generated with ${filteredRows.length} rows (filtered & sorted) with comment columns added`,
  );
  return buffer;
}
