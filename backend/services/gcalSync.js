const { google } = require("googleapis");
const Order = require("../models/order.model");
const Brand = require("../models/brand.model");

function getCalendarClient() {
  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Google Calendar env vars: ${missing.join(", ")}`);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

function toDateOnlyISO(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

function addDays(dateOnlyISO, days) {
  const d = new Date(dateOnlyISO + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeString = (value) => String(value ?? "").trim();
const OMS_KEY_PREFIX = "oms:";

async function resolveBrandCalendarId(brandName) {
  const normalizedBrandName = normalizeString(brandName);
  if (!normalizedBrandName) return null;

  const exactMatch = await Brand.findOne({ name: normalizedBrandName })
    .select("calendar")
    .lean();
  const exactCalendarId = normalizeString(exactMatch?.calendar);
  if (exactCalendarId) return exactCalendarId;

  const caseInsensitiveMatch = await Brand.findOne({
    name: { $regex: `^${escapeRegex(normalizedBrandName)}$`, $options: "i" },
  })
    .select("calendar")
    .lean();
  const caseInsensitiveCalendarId = normalizeString(caseInsensitiveMatch?.calendar);
  return caseInsensitiveCalendarId || null;
}

function makeKey({ order_id, brand, vendor }) {
  // stable key to identify the event for this group
  return `${OMS_KEY_PREFIX}${order_id}:${brand}:${vendor}`;
}

async function deleteOmsEventsFromCalendar({ calendar, calendarId }) {
  let pageToken = undefined;
  const eventIdsToDelete = [];

  do {
    const response = await calendar.events.list({
      calendarId,
      maxResults: 2500,
      showDeleted: false,
      singleEvents: false,
      pageToken,
      timeMin: "1970-01-01T00:00:00.000Z",
      timeMax: "2100-01-01T00:00:00.000Z",
    });

    const items = Array.isArray(response?.data?.items) ? response.data.items : [];
    for (const item of items) {
      const eventId = normalizeString(item?.id);
      if (eventId) eventIdsToDelete.push(eventId);
    }

    pageToken = response?.data?.nextPageToken || undefined;
  } while (pageToken);

  let deleted = 0;
  for (const eventId of eventIdsToDelete) {
    try {
      await calendar.events.delete({ calendarId, eventId });
      deleted += 1;
    } catch (error) {
      if (!isMissingGoogleEventError(error)) throw error;
    }
  }

  return {
    calendarId,
    deleted,
    scanned: eventIdsToDelete.length,
  };
}

const isMissingGoogleEventError = (error) => {
  const code = Number(error?.code || error?.status || error?.response?.status);
  return code === 404 || code === 410;
};

async function deleteTrackedOrderEvents({ calendar }) {
  const trackedEvents = await Order.find({
    "gcal.calendarId": { $ne: null },
    "gcal.eventId": { $ne: null },
  })
    .select("gcal.calendarId gcal.eventId")
    .lean();

  const seen = new Set();
  let deleted = 0;

  for (const doc of trackedEvents) {
    const calendarId = normalizeString(doc?.gcal?.calendarId);
    const eventId = normalizeString(doc?.gcal?.eventId);
    if (!calendarId || !eventId) continue;

    const dedupeKey = `${calendarId}__${eventId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    try {
      await calendar.events.delete({ calendarId, eventId });
      deleted += 1;
    } catch (error) {
      if (!isMissingGoogleEventError(error)) throw error;
    }
  }

  return {
    trackedCount: trackedEvents.length,
    deleted,
  };
}

async function purgeOmsEventsForConfiguredBrandCalendars() {
  const brands = await Brand.find({}).select("calendar").lean();
  const calendarIds = [
    ...new Set(
      brands
        .map((brand) => normalizeString(brand?.calendar))
        .filter(Boolean),
    ),
  ];

  const calendar = getCalendarClient();
  const trackedCleanup = await deleteTrackedOrderEvents({ calendar });

  if (calendarIds.length === 0) {
    return {
      calendars: 0,
      deleted: trackedCleanup.deleted,
      tracked: trackedCleanup,
      results: [],
    };
  }

  const results = [];
  let deleted = 0;

  for (const calendarId of calendarIds) {
    const result = await deleteOmsEventsFromCalendar({ calendar, calendarId });
    results.push(result);
    deleted += Number(result?.deleted || 0);
  }

  return {
    calendars: calendarIds.length,
    deleted: deleted + trackedCleanup.deleted,
    tracked: trackedCleanup,
    results,
  };
}

async function findEventByKey({ calendar, calendarId, key }) {
  // Search by private extended property
  const resp = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`oms_key=${key}`],
    maxResults: 1,
    singleEvents: true,
    showDeleted: false,
  });

  return resp.data.items?.[0] || null;
}

async function createOrUpdateEvent({ calendar, calendarId, key, summary, etdISO, description }) {
  const existing = await findEventByKey({ calendar, calendarId, key });

  const body = {
    summary,
    description,
    start: { date: etdISO },
    end: { date: addDays(etdISO, 1) }, // end is exclusive for all-day events
    extendedProperties: {
      private: {
        oms_key: key,
      },
    },
  };

  if (!existing) {
    const created = await calendar.events.insert({ calendarId, requestBody: body });
    return { action: "created", eventId: created.data.id };
  }

  try {
    const updated = await calendar.events.patch({
      calendarId,
      eventId: existing.id,
      requestBody: body,
    });

    return { action: "updated", eventId: updated.data.id };
  } catch (error) {
    if (!isMissingGoogleEventError(error)) throw error;

    const recreated = await calendar.events.insert({
      calendarId,
      requestBody: body,
    });
    return { action: "recreated", eventId: recreated.data.id };
  }
}

async function deleteEventByKey({ calendar, calendarId, key }) {
  const existing = await findEventByKey({ calendar, calendarId, key });
  if (!existing) return { action: "not_found" };

  try {
    await calendar.events.delete({ calendarId, eventId: existing.id });
  } catch (error) {
    if (!isMissingGoogleEventError(error)) throw error;
    return { action: "not_found" };
  }
  return { action: "deleted" };
}

/**
 * Syncs one (order_id + brand + vendor) group into calendar.
 * - ETD = earliest ETD across items in that group (min)
 * - If no ETD exists => delete calendar event
 */
async function syncOrderGroup({ order_id, brand, vendor }) {
  const calendar = getCalendarClient();
  const key = makeKey({ order_id, brand, vendor });

  // Pull all docs for this group
  const docs = await Order.find({ order_id, brand, vendor }).select("ETD status").lean();

  if (!docs.length) {
    const calendarId = await resolveBrandCalendarId(brand);
    if (!calendarId) {
      return { action: "skipped_no_docs", reason: "missing_brand_calendar" };
    }

    const deleted = await deleteEventByKey({ calendar, calendarId, key });
    return { ...deleted, reason: "no_docs" };
  }

  const calendarId = await resolveBrandCalendarId(brand);

  if (!calendarId) {
    const errorMessage = `No Google Calendar ID configured for brand "${normalizeString(brand) || "unknown"}"`;
    await Order.updateMany(
      { order_id, brand, vendor },
      {
        $set: {
          "gcal.calendarId": null,
          "gcal.eventId": null,
          "gcal.lastSyncedAt": new Date(),
          "gcal.lastSyncError": errorMessage,
        },
      },
    );
    throw new Error(errorMessage);
  }

  const etds = docs.map(d => d.ETD).filter(Boolean);

  if (etds.length === 0) {
    const del = await deleteEventByKey({ calendar, calendarId, key });
    await Order.updateMany({ order_id, brand, vendor }, {
      $set: {
        "gcal.calendarId": null,
        "gcal.eventId": null,
        "gcal.lastSyncedAt": new Date(),
        "gcal.lastSyncError": null,
      }
    });
    return { ...del, reason: "no_etd" };
  }

  // earliest ETD
  const minEtd = new Date(Math.min(...etds.map(d => new Date(d).getTime())));
  const etdISO = toDateOnlyISO(minEtd);

  const summary = `${order_id} | ${vendor}`;
  const description = `Order: ${order_id}\nBrand: ${brand}\nVendor: ${vendor}\nETD: ${etdISO}`;

  const upsert = await createOrUpdateEvent({ calendar, calendarId, key, summary, etdISO, description });

  // store eventId on all docs in the group
  await Order.updateMany({ order_id, brand, vendor }, {
    $set: {
      "gcal.calendarId": calendarId,
      "gcal.eventId": upsert.eventId,
      "gcal.lastSyncedAt": new Date(),
      "gcal.lastSyncError": null,
    },
  });

  return upsert;
}

module.exports = {
  syncOrderGroup,
  purgeOmsEventsForConfiguredBrandCalendars,
};

