const { google } = require("googleapis");
const Order = require("../models/order.model");

function getCalendarClient() {
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

function makeKey({ order_id, brand, vendor }) {
  // stable key to identify the event for this group
  return `oms:${order_id}:${brand}:${vendor}`;
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

  const updated = await calendar.events.patch({
    calendarId,
    eventId: existing.id,
    requestBody: body,
  });

  return { action: "updated", eventId: updated.data.id };
}

async function deleteEventByKey({ calendar, calendarId, key }) {
  const existing = await findEventByKey({ calendar, calendarId, key });
  if (!existing) return { action: "not_found" };

  await calendar.events.delete({ calendarId, eventId: existing.id });
  return { action: "deleted" };
}

/**
 * ✅ Syncs one (order_id + brand + vendor) group into calendar.
 * - ETD = earliest ETD across items in that group (min)
 * - If no ETD exists => delete calendar event
 * - Optional: if all items shipped => delete calendar event
 */
async function syncOrderGroup({ order_id, brand, vendor, deleteWhenShipped = false }) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GCAL_CALENDAR_ID;

  // Pull all docs for this group
  const docs = await Order.find({ order_id, brand, vendor }).select("ETD status").lean();

  if (!docs.length) return { action: "skipped_no_docs" };

  const etds = docs.map(d => d.ETD).filter(Boolean);
  const allShipped = docs.every(d => d.status === "Shipped");

  const key = makeKey({ order_id, brand, vendor });

  if (deleteWhenShipped && allShipped) {
    const del = await deleteEventByKey({ calendar, calendarId, key });
    await Order.updateMany({ order_id, brand, vendor }, {
      $set: { "gcal.calendarId": null, "gcal.eventId": null, "gcal.lastSyncedAt": new Date() }
    });
    return { ...del, reason: "all_shipped" };
  }

  if (etds.length === 0) {
    const del = await deleteEventByKey({ calendar, calendarId, key });
    await Order.updateMany({ order_id, brand, vendor }, {
      $set: { "gcal.calendarId": null, "gcal.eventId": null, "gcal.lastSyncedAt": new Date() }
    });
    return { ...del, reason: "no_etd" };
  }

  // earliest ETD
  const minEtd = new Date(Math.min(...etds.map(d => new Date(d).getTime())));
  const etdISO = toDateOnlyISO(minEtd);

  const summary = `${order_id} | ${brand} | ${vendor}`;
  const description = `Order: ${order_id}\nBrand: ${brand}\nVendor: ${vendor}\nETD: ${etdISO}`;

  const upsert = await createOrUpdateEvent({ calendar, calendarId, key, summary, etdISO, description });

  // store eventId on all docs in the group
  await Order.updateMany({ order_id, brand, vendor }, {
    $set: {
      "gcal.calendarId": calendarId,
      "gcal.eventId": upsert.eventId,
      "gcal.lastSyncedAt": new Date(),
    },
  });

  return upsert;
}

module.exports = { syncOrderGroup };
