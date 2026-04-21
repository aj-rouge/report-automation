import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const BASE_URL = "https://api.baselinker.com/connector.php";

async function callBaselinker(method, parameters = {}) {
  const formData = new URLSearchParams();
  formData.append("method", method);
  formData.append("parameters", JSON.stringify(parameters));

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "X-BLToken": config.baselinkerApiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  const data = await response.json();
  if (data.status !== "SUCCESS") {
    throw new Error(
      `BaseLinker API error (${method}): ${data.error_message || "Unknown error"}`,
    );
  }
  return data;
}

export async function getDefaultInventoryId() {
  const data = await callBaselinker("getInventories");
  const inventories = data.inventories || [];
  const defaultInv =
    inventories.find((inv) => inv.is_default) || inventories[0];
  if (!defaultInv) throw new Error("No inventory found");
  logger.info({ inventoryId: defaultInv.inventory_id }, "Using inventory");
  return defaultInv.inventory_id;
}

export async function getAllProductIds(inventoryId, pageLimit = 200) {
  let page = 1;
  let allIds = [];
  let hasMore = true;
  logger.info({ inventoryId, pageLimit }, "Starting to fetch product IDs");
  while (hasMore) {
    const data = await callBaselinker("getInventoryProductsList", {
      inventory_id: inventoryId,
      page,
      limit: pageLimit,
    });
    const ids = Object.keys(data.products || {}).map((id) => parseInt(id, 10));
    logger.debug(
      { page, batchSize: ids.length, totalSoFar: allIds.length + ids.length },
      `Page ${page} fetched`,
    );
    if (ids.length === 0) {
      hasMore = false;
    } else {
      allIds.push(...ids);
      page++;
      if (ids.length < pageLimit) hasMore = false;
    }
  }
  logger.info(
    { totalProductIds: allIds.length, pages: page - 1 },
    "Fetched all product IDs",
  );
  return allIds;
}

export async function getProductsData(inventoryId, productIds, batchSize = 50) {
  const batches = [];
  for (let i = 0; i < productIds.length; i += batchSize) {
    batches.push(productIds.slice(i, i + batchSize));
  }
  logger.info(
    { totalProducts: productIds.length, batchCount: batches.length, batchSize },
    "Starting to fetch product details",
  );
  const allProducts = [];
  let processedBatches = 0;
  for (const batch of batches) {
    processedBatches++;
    const data = await callBaselinker("getInventoryProductsData", {
      inventory_id: inventoryId,
      products: batch.map((id) => String(id)),
    });
    const productsObj = data.products || {};
    const batchProductCount = Object.keys(productsObj).length;
    allProducts.push(
      ...Object.entries(productsObj).map(([id, productData]) => ({
        product_id: parseInt(id, 10),
        ...productData,
      })),
    );
    logger.debug(
      {
        batch: processedBatches,
        batchSize: batchProductCount,
        totalSoFar: allProducts.length,
      },
      `Batch ${processedBatches}/${batches.length} completed`,
    );
  }
  // Count variants vs main products
  const variantCount = allProducts.filter(
    (p) => p.parent_id || (p.variants && Object.keys(p.variants).length > 0),
  ).length;
  logger.info(
    {
      totalProductsDetails: allProducts.length,
      batchesProcessed: batches.length,
      estimatedVariants: variantCount,
    },
    "Fetched all product details",
  );
  return allProducts;
}

// Hardcoded warehouses (match your Next.js HARDCODED_WAREHOUSES)
export async function getWarehouses() {
  return [
    { warehouse_type: "bl", warehouse_id: 21879, name: "Warehouse" },
    { warehouse_type: "bl", warehouse_id: 31472, name: "Office" },
    { warehouse_type: "bl", warehouse_id: 27316, name: "Loading Bay" },
    {
      warehouse_type: "fulfillment",
      warehouse_id: 19407,
      name: "RT Bytes (FBA)",
    },
    { warehouse_type: "bl", warehouse_id: 42297, name: "Outside" },
  ];
}

export async function getPriceGroups() {
  return [
    { price_group_id: 8140, name: "eBay", currency: "GBP", is_default: true },
    {
      price_group_id: 13007,
      name: "TikTok",
      currency: "GBP",
      is_default: false,
    },
  ];
}

// Hardcoded order statuses (from your HARDCODED_ORDER_STATUSES)
const ORDER_STATUSES = [
  { id: 53167, name: "New orders" },
  { id: 65436, name: "Tracked 24 (P)" },
  { id: 65437, name: "Special Delivery" },
  { id: 65438, name: "Tracked 48 (LL)" },
  { id: 101263, name: "Tracked 48 (P)" },
  { id: 103864, name: "Collection" },
  { id: 113543, name: "Multi-Order" },
  { id: 120444, name: "Dont Dispatch Yet" },
  { id: 129383, name: "eBay Live" },
  { id: 137207, name: "Customs" },
  { id: 138010, name: "Tracked 24 (LL)" },
];

export async function getReservedQuantities() {
  const reserved = {};
  logger.info(
    { statusCount: ORDER_STATUSES.length },
    "Starting to fetch reserved quantities from orders",
  );
  let processedStatuses = 0;
  for (const status of ORDER_STATUSES) {
    processedStatuses++;
    let page = 1;
    let hasMore = true;
    let statusReservedCount = 0;
    logger.debug(
      { statusId: status.id, statusName: status.name },
      `Fetching orders for status ${processedStatuses}/${ORDER_STATUSES.length}`,
    );
    while (hasMore) {
      const data = await callBaselinker("getOrders", {
        status_id: status.id,
        page,
        limit: 100,
        get_unconfirmed_orders: false,
      });
      const orders = data.orders || [];
      for (const order of orders) {
        const products = order.products || [];
        for (const item of products) {
          const variantId = item.product_id;
          if (variantId) {
            const qty = Number(item.quantity) || 0;
            if (!reserved[variantId]) reserved[variantId] = 0;
            reserved[variantId] += qty;
            statusReservedCount += qty;
          }
        }
      }
      logger.debug(
        {
          statusId: status.id,
          page,
          ordersInPage: orders.length,
          statusReservedSoFar: statusReservedCount,
        },
        `Page ${page} for status ${status.name}`,
      );
      hasMore = orders.length === 100;
      page++;
    }
    logger.info(
      {
        statusId: status.id,
        statusName: status.name,
        totalReservedForStatus: statusReservedCount,
      },
      `Finished status ${processedStatuses}/${ORDER_STATUSES.length}`,
    );
  }
  const uniqueProductsReserved = Object.keys(reserved).length;
  const totalReservedUnits = Object.values(reserved).reduce((a, b) => a + b, 0);
  logger.info(
    {
      uniqueProductsReserved,
      totalReservedUnits,
      statusesProcessed: ORDER_STATUSES.length,
    },
    "Fetched all reserved quantities",
  );
  return reserved;
}

export function extractLocationMap(productsDetails) {
  const map = {};
  const processItem = (item, id) => {
    let locationsObj = item.locations;
    if (!locationsObj && item.stock && typeof item.stock === "object") {
      const stockEntries = Object.entries(item.stock);
      const locs = stockEntries
        .map(([key, val]) => (val?.location ? val.location : null))
        .filter(Boolean);
      if (locs.length) locationsObj = locs;
    }
    if (locationsObj && typeof locationsObj === "object") {
      let locationValues = [];
      if (Array.isArray(locationsObj)) {
        locationValues = locationsObj.filter((l) => typeof l === "string");
      } else {
        locationValues = Object.values(locationsObj).filter(
          (l) => typeof l === "string",
        );
      }
      map[id] = [...new Set(locationValues)].join(", ") || "—";
    } else {
      map[id] = "—";
    }
  };
  for (const product of productsDetails) {
    processItem(product, product.product_id);
    if (product.variants) {
      if (Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          const variantId =
            variant.variant_id ?? variant.id ?? variant.product_id;
          if (variantId) processItem(variant, variantId);
        }
      } else if (typeof product.variants === "object") {
        for (const [variantId, variant] of Object.entries(product.variants)) {
          processItem(variant, parseInt(variantId, 10));
        }
      }
    }
  }
  return map;
}
