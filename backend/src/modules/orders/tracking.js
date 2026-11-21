const COURIER_TRACKING_TEMPLATES = Object.freeze({
  Delhivery: 'https://www.delhivery.com/track/package/{awb}',
  DTDC: 'https://www.dtdc.in/tracking.asp?AWB={awb}',
  'India Post': 'https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?articleNumber={awb}',
  'Blue Dart': 'https://www.bluedart.com/web/guest/track?ShipmentNumber={awb}',
  'ST Courier': 'https://stcourier.com/track-shipment?awb={awb}',
  'Professional Couriers': 'https://www.tpcindia.com/Tracking.aspx?awb={awb}',
  'Local delivery (own person)': '',
  Other: '',
});

function validateHttpsUrl(value) {
  if (!value) return true;
  if (String(value).length > 300) return false;
  try {
    const url = new URL(String(value).replace('{awb}', 'TRACKING'));
    return url.protocol === 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
  } catch (_) {
    return false;
  }
}

function buildTrackingUrl(courierName, awb, template) {
  const awbValue = String(awb || '').trim();
  if (!awbValue) return '';
  if (template) {
    if (!validateHttpsUrl(template) || !template.includes('{awb}')) return '';
    return template.replaceAll('{awb}', encodeURIComponent(awbValue));
  }
  const courierTemplate = COURIER_TRACKING_TEMPLATES[courierName];
  if (!courierTemplate) return '';
  if (!courierTemplate.includes('{awb}')) {
    return courierTemplate;
  }
  return courierTemplate.replaceAll('{awb}', encodeURIComponent(awbValue));
}

module.exports = { COURIER_TRACKING_TEMPLATES, validateHttpsUrl, buildTrackingUrl };
