const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ── Cached Belbo data ──
let cachedData = {
  name: 'The Colorist',
  town: 'Meilen',
  street: 'Dorfstrasse 81',
  zip: '8706',
  website: 'thecolorist.ch',
  bookingUrl: 'thecolorist.belbo.com/termin',
  hours: [10, 11, 12, 13, 14, 15, 16, 17, 18],
  openTime: '10:00',
  closeTime: '18:00',
  primaryColor: '#79BD74',
  lastUpdate: null,
  locationImage: null,
  employees: [],
};

async function fetchBelboData() {
  try {
    // Fetch location info (this endpoint works without auth)
    const locResp = await fetch('https://thecolorist.belbo.com/externalBooking/availableLocations', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (locResp.ok) {
      const locData = await locResp.json();
      const loc = locData.locations?.[0];
      if (loc) {
        cachedData.name = loc.name || cachedData.name;
        cachedData.town = loc.address?.town || cachedData.town;
        cachedData.street = `${loc.address?.street || ''} ${loc.address?.houseNumber || ''}`.trim() || cachedData.street;
        cachedData.zip = loc.address?.zip || cachedData.zip;
        cachedData.website = (loc.websiteUrl || '').replace(/^https?:\/\//, '') || cachedData.website;
        cachedData.locationImage = loc.primaryImage?.['500x500'] || loc.primaryImage?.original || null;
      }
    }

    // Fetch settings
    const settingsResp = await fetch('https://thecolorist.belbo.com/mobileData/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'locale=de',
      signal: AbortSignal.timeout(8000),
    });
    if (settingsResp.ok) {
      const settings = await settingsResp.json();
      cachedData.name = settings.accountName || cachedData.name;
      if (settings.primaryGradientTop?.hex) {
        cachedData.primaryColor = settings.primaryGradientTop.hex;
      }
    }

    // --- Fetch Real Employees (Requires ephemeral session) ---
    try {
      let initialCookies = [];
      const terminResp = await fetch('https://thecolorist.belbo.com/termin', { signal: AbortSignal.timeout(8000) });
      const rawCookies = terminResp.headers.getSetCookie ? terminResp.headers.getSetCookie() : [terminResp.headers.get('set-cookie') || ''];
      
      for (const rc of rawCookies) {
          if (rc && rc.includes('SESSION=')) initialCookies.push(rc.split(';')[0]);
      }

      if (initialCookies.length > 0) {
        const bpResp = await fetch('https://thecolorist.belbo.com/externalBooking/bookingProcess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': initialCookies.join('; '), 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ groupId: 4566, locationId: 4566, locale: 'de' }),
          signal: AbortSignal.timeout(8000)
        });
        
        const bpCookies = bpResp.headers.getSetCookie ? bpResp.headers.getSetCookie() : [bpResp.headers.get('set-cookie') || ''];
        let activeCookies = [...initialCookies];
        for (const bc of bpCookies) {
            if (bc && bc.includes('SESSION=')) activeCookies[0] = bc.split(';')[0];
        }

        const srvResp = await fetch('https://thecolorist.belbo.com/newAppointment/calcServicersAPI', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': activeCookies.join('; '), 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            appointmentMoveTokenPlain: '',
            groupId: 4566,
            selectedProducts: [654799],
            landingPage: '',
            locale: 'de',
            bookingSource: ''
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (srvResp.ok) {
          const srvData = await srvResp.json();
          if (srvData && srvData.model && srvData.model.listOfAnyServicers && srvData.model.listOfAnyServicers['0']) {
            const servicers = srvData.model.listOfAnyServicers['0'];
            // Exclude non-human accounts if any exist
            cachedData.employees = servicers.map(s => (s.firstName || s.displayName)).filter(Boolean).slice(0, 4);
          }
        }
      }
    } catch (e) {
      console.error('Failed fetching employees from Belbo:', e.message);
    }

    cachedData.lastUpdate = new Date().toISOString();
    console.log(`[${new Date().toLocaleTimeString('de-CH')}] Belbo data refreshed: ${cachedData.name}, ${cachedData.town}. Staff: ${cachedData.employees.join(', ')}`);
  } catch (err) {
    console.error('Belbo fetch error:', err.message);
  }
}

// API endpoint for frontend
app.get('/api/status', (req, res) => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun
  const isOpen = day >= 2 && day <= 6 && hour >= 10 && hour < 18;
  
  res.json({
    ...cachedData,
    isOpen,
    currentTime: now.toISOString(),
  });
});

// Belbo API proxy (for frontend to avoid CORS)
app.get('/api/proxy/locations', async (req, res) => {
  try {
    const resp = await fetch('https://thecolorist.belbo.com/externalBooking/availableLocations', {
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Initial fetch + periodic refresh
fetchBelboData();
setInterval(fetchBelboData, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n  🎨 Colorist Board running at http://localhost:${PORT}\n`);
});
